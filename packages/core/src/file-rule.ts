import { matchesAnyGlob } from "./config.js";
import type { Diagnostic, Rule, RuleContext } from "./types.js";

export interface FilePathOptions {
  /** Root-relative file globs; defaults to all files. */
  files?: string[];
  ignoredPaths?: string[];
  ignoredDirectories?: string[];
}

export interface FilePathRuleDefinition<TOptions extends FilePathOptions> {
  id: string;
  name: string;
  description: string;
  defaultOptions?: TOptions;
  /** Extra inputs used by the custom validator, in addition to directory listings. */
  requires?: string[];
  /** Recheck all selected files when these root-relative inputs change. */
  recheckOnChanges?: string[];
  /** Return a failure message, or undefined when valid. Options are resolved per file. */
  validate(
    path: string,
    context: RuleContext<TOptions>,
  ): string | undefined | Promise<string | undefined>;
}

const ignoredDirectories = [".git", ".local", ".qg", "node_modules", "dist"];

/** Build an opt-in rule using the runner's filesystem snapshot and path overrides. */
export function createFilePathRule<
  TOptions extends FilePathOptions = FilePathOptions,
>(definition: FilePathRuleDefinition<TOptions>): Rule<TOptions> {
  return {
    metadata: {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      defaultSeverity: "error",
      defaultEnabled: false,
      supports: ["changed", "full"],
      scope: "file",
      requires: [
        ...new Set(["directoryListings", ...(definition.requires ?? [])]),
      ],
      fixable: "none",
      defaultOptions: {
        files: ["**"],
        ignoredPaths: [],
        ignoredDirectories,
        ...definition.defaultOptions,
      } as TOptions,
    },
    async check(context) {
      const paths =
        context.mode === "changed" &&
        !context.changes.some((change) =>
          [change.path, change.oldPath].some(
            (path) =>
              path !== undefined &&
              matchesAnyGlob(path, definition.recheckOnChanges ?? []),
          ),
        )
          ? [
              ...new Set(
                context.changes
                  .filter((change) => change.status !== "deleted")
                  .map((change) => change.path),
              ),
            ].sort()
          : await allFiles(context);
      const diagnostics: Diagnostic[] = [];
      for (const path of paths) {
        const resolved = context.resolveConfig(path);
        if (!resolved.enabled) continue;
        const options = normalizeOptions(resolved.options, definition.id);
        if (
          !matchesAnyGlob(path, options.files) ||
          matchesAnyGlob(path, options.ignoredPaths) ||
          path
            .split("/")
            .some((part) => options.ignoredDirectories.includes(part)) ||
          !(await context.fs.isFile(path))
        )
          continue;
        const message = await definition.validate(path, {
          ...context,
          options: resolved.options,
          severity: resolved.severity,
        });
        if (message !== undefined)
          diagnostics.push({
            ruleId: definition.id,
            severity: resolved.severity,
            scope: "file",
            path,
            message,
          });
      }
      return diagnostics;
    },
  };
}

function normalizeOptions(
  options: FilePathOptions,
  id: string,
): Required<FilePathOptions> {
  return {
    files: stringList(options.files, ["**"], `${id}.files`),
    ignoredPaths: stringList(options.ignoredPaths, [], `${id}.ignoredPaths`),
    ignoredDirectories: stringList(
      options.ignoredDirectories,
      ignoredDirectories,
      `${id}.ignoredDirectories`,
    ),
  };
}

function stringList(
  value: unknown,
  fallback: string[],
  label: string,
): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${label} must be an array of strings.`);
  return value;
}

async function allFiles<TOptions extends FilePathOptions>(
  context: RuleContext<TOptions>,
): Promise<string[]> {
  const options = normalizeOptions(context.options, "File path rule");
  const paths: string[] = [];
  const pending = ["."];
  while (pending.length) {
    const directory = pending.shift();
    if (!directory) continue;
    for (const entry of await context.fs.readDirectory(directory)) {
      if (
        entry.type === "directory" &&
        !options.ignoredDirectories.includes(entry.name)
      )
        pending.push(entry.path);
      else if (entry.type === "file") paths.push(entry.path);
    }
  }
  return paths.sort();
}
