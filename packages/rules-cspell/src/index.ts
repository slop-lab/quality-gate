import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createRuleProvider,
  type Diagnostic,
  type GeneratedArtifactRuleOptions,
  matchesAnyGlob,
  type Rule,
  type RuleContext,
} from "@slop-lab/qg-core";
import { clearCachedFiles, spellCheckDocument } from "cspell-lib";

export interface CSpellRuleOptions extends GeneratedArtifactRuleOptions {
  files?: string[];
  ignoredPaths?: string[];
  ignoredDirectories?: string[];
  /** CSpell config path, relative to the project root. Omit to discover nearby config. */
  configFile?: string;
  locale?: string;
  generateSuggestions?: boolean;
}

const ignoredDirectories = [".git", ".local", ".qg", "node_modules", "dist"];
// CSpell has process-wide config/dictionary caches. Serialize refreshes and scans.
let pending: Promise<void> = Promise.resolve();

export const cspellRule: Rule<CSpellRuleOptions> = {
  metadata: {
    id: "external/cspell",
    name: "CSpell spelling check",
    description:
      "Checks snapshot text with CSpell and project dictionaries. Explicit opt-in required.",
    defaultSeverity: "error",
    defaultEnabled: false,
    ignoreGeneratedArtifacts: true,
    supports: ["changed", "full"],
    scope: "file",
    requires: ["fileContent", "directoryListings", "workingTree"],
    fixable: "none",
    defaultOptions: {
      files: ["**"],
      ignoredPaths: [],
      ignoredDirectories,
      generateSuggestions: false,
    },
  },
  check(context) {
    const result = pending.then(async () => {
      await clearCachedFiles();
      return checkFiles(context);
    });
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  },
};

/** CLI ruleModules entrypoint; usable directly by library callers too. */
export const rules = [cspellRule];
export const ruleProvider = createRuleProvider(rules);

async function checkFiles(
  context: RuleContext<CSpellRuleOptions>,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const path of await candidates(context)) {
    const config = context.resolveConfig(path);
    if (!config.enabled) continue;
    const options = normalizeOptions(config.options);
    if (
      !matchesAnyGlob(path, options.files) ||
      matchesAnyGlob(path, options.ignoredPaths) ||
      path
        .split("/")
        .some((part) => options.ignoredDirectories.includes(part)) ||
      !(await context.fs.isFile(path))
    )
      continue;
    const bytes = await context.fs.readFileBytes(path);
    if (bytes.includes(0)) continue;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      continue;
    }
    const result = await spellCheckDocument(
      {
        uri: pathToFileURL(resolve(context.root, path)).href,
        text,
        ...(options.locale === undefined ? {} : { locale: options.locale }),
      },
      {
        generateSuggestions: options.generateSuggestions,
        ...(options.configFile === undefined
          ? {}
          : { configFile: resolve(context.root, options.configFile) }),
      },
      {},
    );
    const errors = [
      ...(result.errors ?? []),
      ...(result.configErrors ?? []).map((entry) => entry.error),
      ...[...(result.dictionaryErrors?.values() ?? [])].flat(),
    ];
    if (errors.length)
      throw new Error(
        `external/cspell: cannot check ${path}: ${[...new Set(errors.map((error) => error.message))].join("; ")}`,
      );
    const starts = [0];
    for (let index = 0; index < text.length; index++)
      if (text[index] === "\n") starts.push(index + 1);
    for (const issue of result.issues) {
      let low = 0;
      let high = starts.length;
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (starts[middle] <= issue.offset) low = middle;
        else high = middle;
      }
      const column = issue.offset - starts[low] + 1;
      diagnostics.push({
        ruleId: cspellRule.metadata.id,
        severity: config.severity,
        scope: "file",
        path,
        message: `${issue.message ?? (issue.isFlagged ? "Forbidden word" : "Unknown word")}: ${issue.text}`,
        line: low + 1,
        column,
        endLine: low + 1,
        endColumn: column + (issue.length ?? issue.text.length),
        metadata: {
          word: issue.text,
          suggestions: issue.suggestions ?? [],
          isFlagged: issue.isFlagged ?? false,
        },
      });
    }
  }
  return diagnostics;
}

function normalizeOptions(options: CSpellRuleOptions) {
  const strings = (
    value: unknown,
    fallback: string[],
    name: string,
  ): string[] => {
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
      throw new Error(`external/cspell: ${name} must be an array of strings.`);
    return value;
  };
  for (const name of ["configFile", "locale"] as const) {
    if (
      options[name] !== undefined &&
      (typeof options[name] !== "string" || !options[name]?.trim())
    )
      throw new Error(`external/cspell: ${name} must be a non-empty string.`);
  }
  if (
    options.generateSuggestions !== undefined &&
    typeof options.generateSuggestions !== "boolean"
  )
    throw new Error("external/cspell: generateSuggestions must be a boolean.");
  return {
    ...options,
    files: strings(options.files, ["**"], "files"),
    ignoredPaths: strings(options.ignoredPaths, [], "ignoredPaths"),
    ignoredDirectories: strings(
      options.ignoredDirectories,
      ignoredDirectories,
      "ignoredDirectories",
    ),
    generateSuggestions: options.generateSuggestions ?? false,
  };
}

async function candidates(
  context: RuleContext<CSpellRuleOptions>,
): Promise<string[]> {
  if (context.mode === "changed")
    return [
      ...new Set(
        context.changes
          .filter((change) => change.status !== "deleted")
          .map((change) => change.path),
      ),
    ].sort();
  const options = normalizeOptions(context.options);
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
