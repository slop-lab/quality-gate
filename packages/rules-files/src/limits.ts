import {
  type Diagnostic,
  type DiagnosticSeverity,
  type GeneratedArtifactRuleOptions,
  matchesAnyGlob,
  type Rule,
  type RuleContext,
  type RuleMetadata,
} from "@slop-lab/qg-core";

export interface FileLimitOptions extends GeneratedArtifactRuleOptions {
  limit: number;
  /** max-lines only: warn above this count before reaching the error limit. */
  warningLimit?: number;
  ignoredPaths?: string[];
  ignoredDirectories?: string[];
}

const ignoredPaths: string[] = [];
const ignoredDirectories = [".git", ".local", ".qg", "node_modules", "dist"];

export const maxBytesRule: Rule<FileLimitOptions> = {
  metadata: metadata(
    "files/max-bytes",
    "Maximum file size",
    "Reports files larger than the configured byte limit.",
    1_000_000,
  ),
  async check(context) {
    return checkFiles(
      context,
      maxBytesRule.metadata.id,
      async (path, bytes, options) => {
        if (bytes.byteLength <= options.limit) return [];
        return [
          diagnostic(
            context,
            path,
            `File is ${bytes.byteLength} bytes; maximum is ${options.limit} bytes.`,
          ),
        ];
      },
    );
  },
};

export const maxLineLengthRule: Rule<FileLimitOptions> = {
  metadata: metadata(
    "files/max-line-length",
    "Maximum line length",
    "Reports text lines longer than the configured character limit.",
    500,
  ),
  async check(context) {
    return checkFiles(
      context,
      maxLineLengthRule.metadata.id,
      async (path, bytes, options) => {
        if (isBinary(bytes)) return [];
        const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
        const diagnostics: Diagnostic[] = [];
        for (const [index, line] of lines.entries()) {
          const length = Array.from(line).length;
          if (length > options.limit) {
            diagnostics.push({
              ...diagnostic(
                context,
                path,
                `Line has ${length} characters; maximum is ${options.limit}.`,
              ),
              line: index + 1,
              column: options.limit + 1,
            });
          }
        }
        return diagnostics;
      },
    );
  },
};

export const maxLinesRule: Rule<FileLimitOptions> = {
  metadata: metadata(
    "files/max-lines",
    "Maximum line count",
    "Warns above 500 lines and errors above 1000 lines by default.",
    1_000,
    500,
  ),
  async check(context) {
    return checkFiles(
      context,
      maxLinesRule.metadata.id,
      async (path, bytes, options) => {
        if (isBinary(bytes)) return [];
        const text = new TextDecoder().decode(bytes);
        const count =
          text.length === 0
            ? 0
            : text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0);
        const severity =
          count > options.limit
            ? "error"
            : count > options.warningLimit
              ? "warning"
              : undefined;
        if (!severity) return [];
        const limit =
          severity === "error" ? options.limit : options.warningLimit;
        return [
          diagnostic(
            context,
            path,
            `File has ${count} lines; ${severity} threshold is ${limit}.`,
            severity,
          ),
        ];
      },
    );
  },
};

export const fileRules = [maxBytesRule, maxLineLengthRule, maxLinesRule];

function metadata(
  id: string,
  name: string,
  description: string,
  limit: number,
  warningLimit?: number,
): RuleMetadata<FileLimitOptions> {
  return {
    id,
    name,
    description,
    defaultSeverity: "error" as const,
    ignoreGeneratedArtifacts: true,
    preserveDiagnosticSeverity: warningLimit !== undefined,
    supports: ["changed", "full"],
    scope: "file" as const,
    requires: ["fileContent"],
    fixable: "none" as const,
    defaultOptions: {
      limit,
      ignoredPaths,
      ignoredDirectories,
      ...(warningLimit !== undefined ? { warningLimit } : {}),
    },
  };
}

async function checkFiles(
  context: RuleContext<FileLimitOptions>,
  ruleId: string,
  check: (
    path: string,
    bytes: Uint8Array,
    options: Required<FileLimitOptions>,
  ) => Promise<Diagnostic[]>,
): Promise<Diagnostic[]> {
  const paths =
    context.mode === "changed"
      ? changedFiles(context)
      : await allFiles(context);
  const diagnostics: Diagnostic[] = [];
  for (const path of paths) {
    const resolved = context.resolveConfig(path);
    if (!resolved.enabled) continue;
    const options = normalizeOptions(resolved.options);
    if (matchesAnyGlob(path, options.ignoredPaths)) continue;
    if (
      path.split("/").some((part) => options.ignoredDirectories.includes(part))
    )
      continue;
    if (!(await context.fs.isFile(path))) continue;
    diagnostics.push(
      ...(await check(path, await context.fs.readFileBytes(path), options)).map(
        (item) => ({ ...item, ruleId }),
      ),
    );
  }
  return diagnostics;
}

function changedFiles(context: RuleContext<FileLimitOptions>): string[] {
  return [
    ...new Set(
      context.changes
        .filter((change) => change.status !== "deleted")
        .map((change) => change.path),
    ),
  ].sort();
}

async function allFiles(
  context: RuleContext<FileLimitOptions>,
): Promise<string[]> {
  const files: string[] = [];
  const pending = ["."];
  while (pending.length > 0) {
    const directory = pending.shift();
    if (!directory) continue;
    const globalOptions = normalizeOptions(context.options);
    for (const entry of await context.fs.readDirectory(directory)) {
      if (entry.type === "directory") {
        if (
          !entry.path
            .split("/")
            .some((part) => globalOptions.ignoredDirectories.includes(part))
        )
          pending.push(entry.path);
      } else if (entry.type === "file") {
        files.push(entry.path);
      }
    }
  }
  return files.sort();
}

function normalizeOptions(
  options: FileLimitOptions,
): Required<FileLimitOptions> {
  for (const [name, value] of [
    ["limit", options.limit],
    ["warningLimit", options.warningLimit],
  ] as const)
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
      throw new Error(`File ${name} must be a non-negative integer.`);
  return {
    limit: options.limit,
    warningLimit: options.warningLimit ?? options.limit,
    includeGenerated: options.includeGenerated ?? false,
    ignoredPaths: options.ignoredPaths ?? ignoredPaths,
    ignoredDirectories: options.ignoredDirectories ?? ignoredDirectories,
  };
}

function diagnostic(
  context: RuleContext<FileLimitOptions>,
  path: string,
  message: string,
  severity?: DiagnosticSeverity,
): Diagnostic {
  return {
    ruleId: "",
    severity: severity ?? context.severity,
    message,
    path,
    scope: "file",
  };
}

function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8_000).includes(0);
}
