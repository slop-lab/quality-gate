import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import {
  cacheKey,
  type Diagnostic,
  type FileSystemProvider,
  matchesAnyGlob,
  NodeFileSystemProvider,
  type ProcessResult,
  type Rule,
  type RuleContext,
} from "@slop-lab/qg-core";

export interface ExternalToolOptions {
  /** Override the executable; arguments are passed directly, without a shell. */
  command?: string;
  /** Arguments before the tool's subcommand/flags (for example, a Node entry point). */
  commandArgs?: string[];
  /** Additional tool flags, after Biome's subcommand. */
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  files?: string[];
  ignoredPaths?: string[];
  ignoredDirectories?: string[];
  cache?: boolean;
  /** Additional files outside the project or excluded directories affecting results. */
  cacheInputs?: string[];
  /** Biome only: connect to an already running Biome server. */
  useServer?: boolean;
  /** Biome only. */
  mode?: "check" | "lint" | "format";
}

type Tool = "biome" | "prettier" | "eslint";
const excludedDirectories = [".git", ".local", ".qg", "node_modules", "dist"];
const defaults = {
  biome: [
    "**/*.js",
    "**/*.jsx",
    "**/*.mjs",
    "**/*.cjs",
    "**/*.ts",
    "**/*.tsx",
    "**/*.json",
    "**/*.jsonc",
    "**/*.css",
  ],
  prettier: [
    "**/*.js",
    "**/*.jsx",
    "**/*.mjs",
    "**/*.cjs",
    "**/*.ts",
    "**/*.tsx",
    "**/*.json",
    "**/*.jsonc",
    "**/*.css",
    "**/*.scss",
    "**/*.html",
    "**/*.vue",
    "**/*.yaml",
    "**/*.yml",
    "**/*.md",
    "**/*.mdx",
  ],
  eslint: [
    "**/*.js",
    "**/*.jsx",
    "**/*.mjs",
    "**/*.cjs",
    "**/*.ts",
    "**/*.tsx",
  ],
};

export const biomeRule = externalRule("biome");
export const prettierRule = externalRule("prettier");
export const eslintRule = externalRule("eslint");
export const externalToolRules = [biomeRule, prettierRule, eslintRule];

function externalRule(tool: Tool): Rule<ExternalToolOptions> {
  const id = `external/${tool}`;
  return {
    metadata: {
      id,
      name: `External ${tool} check`,
      description: `Checks snapshot contents using the project's ${tool} installation and configuration. Explicit opt-in required.`,
      defaultSeverity: "error",
      defaultEnabled: false,
      preserveDiagnosticSeverity: true,
      supports: ["changed", "full"],
      scope: "file",
      requires: ["fileContent", "directoryListings", "process", "workingTree"],
      fixable: "none",
      defaultOptions: { cache: true, timeoutMs: 30_000, mode: "check" },
    },
    async check(context) {
      const diagnostics: Diagnostic[] = [];
      const invocations = new Map<string, Promise<Invocation>>();
      let fingerprint: Promise<string> | undefined;
      for (const path of await candidates(context)) {
        const config = context.resolveConfig(path);
        const options = config.options;
        if (
          !config.enabled ||
          !selected(path, tool, options) ||
          !(await context.fs.isFile(path))
        )
          continue;
        validateOptions(tool, options);
        const signature = JSON.stringify(options);
        let invocation = invocations.get(signature);
        if (!invocation) {
          invocation = resolveInvocation(context, tool, options);
          invocations.set(signature, invocation);
        }
        const executable = await invocation;
        const input = await context.fs.readFile(path);
        const args = [
          ...executable.args,
          ...(tool === "biome" ? [options.mode ?? "check"] : []),
          ...(options.args ?? []),
          ...managedArgs(tool, options, resolve(context.root, path)),
        ];
        let key: string | undefined;
        if (options.cache !== false) {
          fingerprint ??= projectFingerprint(
            new NodeFileSystemProvider(context.root),
          );
          const extraInputs = await Promise.all(
            (options.cacheInputs ?? []).map(async (name) => {
              const absolute = resolve(context.root, name);
              return [absolute, cacheKey(await readFile(absolute))];
            }),
          );
          key = cacheKey(
            JSON.stringify([
              1,
              tool,
              executable,
              args,
              options,
              process.version,
              process.env,
              await fingerprint,
              extraInputs,
              input,
            ]),
          );
        }
        const cached = key
          ? await context.cache.get<{ key: string; result: ProcessResult }>(
              path,
            )
          : undefined;
        const result =
          cached && cached.key === key
            ? cached.result
            : await context.process.exec({
                command: executable.command,
                args,
                cwd: context.root,
                env: options.env,
                timeoutMs: options.timeoutMs,
                input,
              });
        const found = diagnosticsFor(tool, id, path, options, input, result);
        if (key && cached?.key !== key)
          await context.cache.set(path, { key, result });
        diagnostics.push(...found);
      }
      return diagnostics;
    },
  };
}

interface Invocation {
  command: string;
  args: string[];
  version: string;
}

async function resolveInvocation(
  context: RuleContext<ExternalToolOptions>,
  tool: Tool,
  options: ExternalToolOptions,
): Promise<Invocation> {
  let command = options.command;
  let args = options.commandArgs ?? [];
  if (!command) {
    const packageName = tool === "biome" ? "@biomejs/biome" : tool;
    let manifestPath: string | undefined;
    try {
      manifestPath = createRequire(
        resolve(context.root, "package.json"),
      ).resolve(`${packageName}/package.json`);
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "MODULE_NOT_FOUND"
        )
      )
        throw error;
    }
    if (manifestPath) {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        bin: string | Record<string, string>;
      };
      const bin =
        typeof manifest.bin === "string" ? manifest.bin : manifest.bin[tool];
      if (!bin)
        throw new Error(
          `${packageName} does not provide a ${tool} executable.`,
        );
      command = process.execPath;
      args = [resolve(manifestPath, "..", bin), ...args];
    } else
      command =
        tool === "biome" && process.platform === "win32" ? "biome.exe" : tool;
  }
  if ([".cmd", ".bat"].includes(extname(command).toLowerCase()))
    throw new Error(
      `external/${tool}: use a native executable or Node with a JS entry point instead of a batch file.`,
    );
  try {
    const result = await context.process.exec({
      command,
      args: [...args, "--version"],
      cwd: context.root,
      env: options.env,
      timeoutMs: options.timeoutMs,
    });
    if (result.exitCode !== 0)
      throw new Error(
        result.stderr || result.stdout || `exit ${result.exitCode}`,
      );
    return { command, args, version: result.stdout.trim() };
  } catch (error) {
    throw new Error(
      `external/${tool}: cannot run ${command}. Install ${tool} locally or configure command and commandArgs. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function managedArgs(
  tool: Tool,
  options: ExternalToolOptions,
  path: string,
): string[] {
  if (tool === "eslint")
    return ["--stdin", "--stdin-filename", path, "--format", "json"];
  if (tool === "prettier") return ["--check", "--stdin-filepath", path];
  return [
    `--stdin-file-path=${path}`,
    ...(options.useServer ? ["--use-server"] : []),
  ];
}

function validateOptions(tool: Tool, options: ExternalToolOptions): void {
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
  )
    throw new Error(`external/${tool}: timeoutMs must be positive.`);
  if (
    tool === "biome" &&
    options.mode !== undefined &&
    !["check", "lint", "format"].includes(options.mode)
  )
    throw new Error("external/biome: mode must be check, lint, or format.");
  for (const arg of options.args ?? []) {
    if (
      /^--(?:write|fix(?:-.*)?|cache(?:-.*)?|output-file|reporter|stdin(?:-.*)?|check|list-different|watch)(?:=|$)/.test(
        arg,
      ) ||
      ["-w", "-l", "-o", "-f", "--format", "--"].includes(arg)
    )
      throw new Error(
        `external/${tool}: argument ${arg} conflicts with the read-only stdin protocol.`,
      );
  }
}

function diagnosticsFor(
  tool: Tool,
  id: string,
  path: string,
  options: ExternalToolOptions,
  input: string,
  result: ProcessResult,
): Diagnostic[] {
  const diagnostic = (message: string): Diagnostic => ({
    ruleId: id,
    severity: "error",
    message,
    path,
    scope: "file",
    metadata: {
      tool,
      stderr: result.stderr,
      ...(tool === "prettier" ? { stdout: result.stdout } : {}),
    },
  });
  if (![0, 1].includes(result.exitCode))
    throw new Error(
      `${id} failed for ${path} (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  if (
    tool === "biome" &&
    result.exitCode === 1 &&
    !result.stderr.includes("The contents aren't fixed")
  )
    throw new Error(
      `${id} failed for ${path}: ${result.stderr || result.stdout}`,
    );
  if (tool === "eslint") {
    const reports: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(reports))
      throw new Error(`${id}: expected a JSON report for ${path}.`);
    const diagnostics = reports.flatMap(
      (report: {
        messages: Array<{
          severity: number;
          message: string;
          ruleId?: string;
          line?: number;
          column?: number;
          endLine?: number;
          endColumn?: number;
        }>;
      }) =>
        report.messages
          .filter((message) => message.severity > 0)
          .map(
            (message): Diagnostic => ({
              ...diagnostic(
                message.ruleId
                  ? `${message.ruleId}: ${message.message}`
                  : message.message,
              ),
              severity: message.severity === 1 ? "warning" : "error",
              line: message.line,
              column: message.column,
              endLine: message.endLine,
              endColumn: message.endColumn,
              metadata: { tool, toolRuleId: message.ruleId },
            }),
          ),
    );
    if (
      result.exitCode === 1 &&
      !diagnostics.some((item) => item.severity === "error")
    )
      diagnostics.push(
        diagnostic(
          `ESLint failed its exit threshold: ${result.stderr.trim() || "exit 1"}`,
        ),
      );
    return diagnostics;
  }
  if (tool === "biome" && options.mode === "format" && result.exitCode === 0)
    return result.stdout === input
      ? []
      : [diagnostic("Biome formatting differs from the checked contents.")];
  if (result.exitCode === 0) return [];
  return [
    diagnostic(
      tool === "prettier"
        ? "Prettier formatting differs from the checked contents."
        : `Biome ${options.mode ?? "check"} failed: ${result.stderr.trim() || "the checked contents do not pass"}`,
    ),
  ];
}

function selected(
  path: string,
  tool: Tool,
  options: ExternalToolOptions,
): boolean {
  return (
    matchesAnyGlob(path, options.files ?? defaults[tool]) &&
    !matchesAnyGlob(path, options.ignoredPaths ?? []) &&
    !path
      .split("/")
      .some((part) =>
        (options.ignoredDirectories ?? excludedDirectories).includes(part),
      )
  );
}

async function candidates(
  context: RuleContext<ExternalToolOptions>,
): Promise<string[]> {
  if (context.mode === "changed")
    return [
      ...new Set(
        context.changes
          .filter((change) => change.status !== "deleted")
          .map((change) => change.path),
      ),
    ].sort();
  return walk(
    context.fs,
    context.options.ignoredDirectories ?? excludedDirectories,
  );
}

async function walk(
  fs: FileSystemProvider,
  ignored: string[],
): Promise<string[]> {
  const paths: string[] = [];
  const pending = ["."];
  while (pending.length) {
    const directory = pending.shift();
    if (!directory) continue;
    for (const entry of await fs.readDirectory(directory)) {
      if (entry.type === "directory" && !ignored.includes(entry.name))
        pending.push(entry.path);
      else if (entry.type === "file") paths.push(entry.path);
    }
  }
  return paths.sort();
}

async function projectFingerprint(fs: FileSystemProvider): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await walk(fs, excludedDirectories)) {
    hash.update(JSON.stringify([path, cacheKey(await fs.readFileBytes(path))]));
  }
  return hash.digest("hex");
}
