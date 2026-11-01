import { posix } from "node:path";
import {
  cacheKey,
  type Diagnostic,
  type FileSystemProvider,
  type GeneratedArtifactRuleOptions,
  matchesAnyGlob,
  pluginFingerprint,
  type RecheckTriggerPlugin,
  type Rule,
  shouldRecheckAllFiles,
  type VersionedPlugin,
} from "@slop-lab/qg-core";

export interface FileReferenceOccurrence {
  reference: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface FileReferencePlugin<
  TOptions extends ValidFileReferenceOptions = ValidFileReferenceOptions,
> extends VersionedPlugin {
  supports(path: string, options: TOptions): boolean;
  extract(input: {
    path: string;
    content: string;
    options: TOptions;
  }): FileReferenceOccurrence[] | Promise<FileReferenceOccurrence[]>;
}

export interface ValidFileReferenceOptions
  extends GeneratedArtifactRuleOptions {
  ignoredPaths?: string[];
  allowDirectories?: boolean;
}

export interface FileReferenceRuleDefinition<
  TOptions extends ValidFileReferenceOptions = ValidFileReferenceOptions,
> {
  id: string;
  name: string;
  description: string;
  plugins: readonly FileReferencePlugin<TOptions>[];
  defaultOptions?: TOptions;
  defaultEnabled?: boolean;
  recheckTriggers?: readonly RecheckTriggerPlugin[];
}

interface CachedOccurrence extends FileReferenceOccurrence {
  pluginId: string;
}

const targetChangeTrigger: RecheckTriggerPlugin = {
  id: "qg/reference-target-change",
  version: "1",
  shouldRecheck(input) {
    return input.changes.some((change) =>
      ["deleted", "renamed"].includes(change.status),
    );
  },
};

/** Build a file-reference rule from versioned extractor plugins. */
export function createValidFileReferenceRule<
  TOptions extends ValidFileReferenceOptions = ValidFileReferenceOptions,
>(definition: FileReferenceRuleDefinition<TOptions>): Rule<TOptions> {
  const plugins = [...definition.plugins];
  const pluginSet = pluginFingerprint(plugins);
  const recheckTriggers = [
    targetChangeTrigger,
    ...(definition.recheckTriggers ?? []),
  ];
  return {
    metadata: {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      defaultSeverity: "error",
      defaultEnabled: definition.defaultEnabled,
      supports: ["changed", "full"],
      scope: "file",
      requires: ["fileContent", "fileMetadata", "directoryListings"],
      fixable: "suggestion",
      defaultOptions: {
        ignoredPaths: [],
        allowDirectories: true,
        includeGenerated: false,
        ...definition.defaultOptions,
      } as TOptions,
      ignoreGeneratedArtifacts: true,
    },
    async check(context) {
      const candidates = await referenceCandidates(context, recheckTriggers);
      const diagnostics: Diagnostic[] = [];
      for (const path of candidates) {
        const resolved = context.resolveConfig(path);
        if (!resolved.enabled || !(await context.fs.isFile(path))) continue;
        const options = resolved.options;
        if (matchesAnyGlob(path, stringList(options.ignoredPaths))) continue;
        const applicable = plugins.filter((plugin) =>
          plugin.supports(path, options),
        );
        if (applicable.length === 0) continue;
        const bytes = await context.fs.readFileBytes(path);
        const key = cacheKey(
          "file-reference-rule-v1",
          definition.id,
          pluginSet,
          pluginFingerprint(applicable),
          path,
          JSON.stringify(options),
          bytes,
        );
        let occurrences = await context.cache.get<CachedOccurrence[]>(key);
        if (!occurrences) {
          const content = new TextDecoder().decode(bytes);
          occurrences = deduplicate(
            (
              await Promise.all(
                applicable.map(async (plugin) =>
                  (
                    await plugin.extract({ path, content, options })
                  ).map((occurrence) => ({
                    ...occurrence,
                    pluginId: plugin.id,
                  })),
                ),
              )
            ).flat(),
          );
          await context.cache.set(key, occurrences);
        }
        for (const occurrence of occurrences) {
          const target = resolveLocalReference(path, occurrence.reference);
          if (!target) continue;
          const outside = target === ".." || target.startsWith("../");
          const exists =
            !outside &&
            ((await context.fs.isFile(target)) ||
              (options.allowDirectories !== false &&
                (await context.fs.isDirectory(target))));
          if (exists) continue;
          diagnostics.push({
            ruleId: definition.id,
            severity: resolved.severity,
            message: `Local file reference does not exist: ${occurrence.reference} (resolved to ${target}).`,
            path,
            line: occurrence.line,
            column: occurrence.column,
            endLine: occurrence.endLine ?? occurrence.line,
            endColumn:
              occurrence.endColumn ??
              occurrence.column + occurrence.reference.length,
            scope: "file",
            metadata: { pluginId: occurrence.pluginId, target },
            suggestedFix: {
              message: "Create the target or update the local reference.",
            },
          });
        }
      }
      return diagnostics;
    },
  };
}

export function resolveLocalReference(
  sourcePath: string,
  reference: string,
): string | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return undefined;
  const pathname = reference.split(/[?#]/)[0];
  if (!pathname) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  return decoded.startsWith("/")
    ? posix.normalize(decoded.slice(1))
    : posix.join(posix.dirname(sourcePath), decoded);
}

async function referenceCandidates<TOptions extends ValidFileReferenceOptions>(
  context: Parameters<Rule<TOptions>["check"]>[0],
  triggers: readonly RecheckTriggerPlugin[],
): Promise<string[]> {
  if (await shouldRecheckAllFiles(context, triggers))
    return collectFiles(context.fs);
  return [
    ...new Set(
      context.changes
        .filter((change) => change.status !== "deleted")
        .map((change) => change.path),
    ),
  ].sort();
}

async function collectFiles(fs: FileSystemProvider): Promise<string[]> {
  const files: string[] = [];
  const pending = ["."];
  while (pending.length > 0) {
    const directory = pending.shift();
    if (!directory) continue;
    for (const entry of await fs.readDirectory(directory)) {
      if (
        entry.type === "directory" &&
        ![".git", ".local", ".qg", "node_modules", "dist"].includes(entry.name)
      )
        pending.push(entry.path);
      else if (entry.type === "file") files.push(entry.path);
    }
  }
  return files.sort();
}

function stringList(value: string[] | undefined): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error("ignoredPaths must be an array of strings.");
  return value;
}

function deduplicate(occurrences: CachedOccurrence[]): CachedOccurrence[] {
  const seen = new Set<string>();
  return occurrences.filter((occurrence) => {
    const key = JSON.stringify([
      occurrence.reference,
      occurrence.line,
      occurrence.column,
      occurrence.endLine,
      occurrence.endColumn,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
