import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";
import {
  cacheKey,
  type Diagnostic,
  type FileSystemProvider,
  type GeneratedArtifactRuleOptions,
  matchesAnyGlob,
  NodeFileSystemProvider,
  type ProcessResult,
  type Rule,
  type RuleContext,
} from "@slop-lab/qg-core";

export interface StdinRuleOptions extends GeneratedArtifactRuleOptions {
  /** Override the executable; arguments are passed directly, without a shell. */
  command?: string;
  /** Arguments before the tool's subcommand/flags (for example, a Node entry point). */
  commandArgs?: string[];
  /** Additional tool flags interpreted by the adapter. */
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  files?: string[];
  ignoredPaths?: string[];
  ignoredDirectories?: string[];
  cache?: boolean;
  /** Additional files outside the project or excluded directories affecting results. */
  cacheInputs?: string[];
}

export interface StdinRuleDefinition<
  TOptions extends StdinRuleOptions = StdinRuleOptions,
> {
  id: string;
  name: string;
  description: string;
  /** Package and binary resolved in the consuming project, unless command is set. */
  packageName: string;
  binaryName: string;
  /** Executable on PATH when the local package is absent; defaults to binaryName. */
  fallbackCommand?: string;
  files: string[];
  defaultOptions?: Partial<NoInfer<TOptions>>;
  /** Reject unsafe flags before executable discovery. */
  validateOptions(options: TOptions): void;
  /** Build read-only stdin arguments, including any configured extra flags. */
  args(path: string, options: TOptions): string[];
  /** Throw for execution/protocol errors so invalid results never enter the cache. */
  diagnostics(
    path: string,
    options: TOptions,
    input: string,
    result: ProcessResult,
  ): Diagnostic[];
}

const excludedDirectories = [".git", ".local", ".qg", "node_modules", "dist"];

export function createStdinRule<
  TOptions extends StdinRuleOptions = StdinRuleOptions,
>(definition: StdinRuleDefinition<TOptions>): Rule<TOptions> {
  const id = definition.id;
  return {
    metadata: {
      id,
      name: definition.name,
      description: definition.description,
      defaultSeverity: "error",
      defaultEnabled: false,
      ignoreGeneratedArtifacts: true,
      preserveDiagnosticSeverity: true,
      supports: ["changed", "full"],
      scope: "file",
      requires: ["fileContent", "directoryListings", "process", "workingTree"],
      fixable: "none",
      defaultOptions: {
        cache: true,
        timeoutMs: 30_000,
        ...definition.defaultOptions,
      } as TOptions,
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
          !selected(path, definition.files, options) ||
          !(await context.fs.isFile(path))
        )
          continue;
        if (
          options.timeoutMs !== undefined &&
          (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
        )
          throw new Error(`${id}: timeoutMs must be positive.`);
        definition.validateOptions(options);
        const signature = JSON.stringify(options);
        let invocation = invocations.get(signature);
        if (!invocation) {
          invocation = resolveInvocation(context, definition, options);
          invocations.set(signature, invocation);
        }
        const executable = await invocation;
        const input = await context.fs.readFile(path);
        const args = [
          ...executable.args,
          ...definition.args(resolve(context.root, path), options),
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
              id,
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
        const found = definition.diagnostics(path, options, input, result);
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

async function resolveInvocation<TOptions extends StdinRuleOptions>(
  context: RuleContext<TOptions>,
  definition: StdinRuleDefinition<TOptions>,
  options: TOptions,
): Promise<Invocation> {
  let command = options.command;
  let args = options.commandArgs ?? [];
  if (!command) {
    const packageName = definition.packageName;
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
        typeof manifest.bin === "string"
          ? manifest.bin
          : manifest.bin[definition.binaryName];
      if (!bin)
        throw new Error(
          `${packageName} does not provide a ${definition.binaryName} executable.`,
        );
      command = process.execPath;
      args = [resolve(manifestPath, "..", bin), ...args];
    } else command = definition.fallbackCommand ?? definition.binaryName;
  }
  if ([".cmd", ".bat"].includes(extname(command).toLowerCase()))
    throw new Error(
      `${definition.id}: use a native executable or Node with a JS entry point instead of a batch file.`,
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
      `${definition.id}: cannot run ${command}. Install ${definition.packageName} locally or configure command and commandArgs. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function selected(
  path: string,
  files: string[],
  options: StdinRuleOptions,
): boolean {
  return (
    matchesAnyGlob(path, options.files ?? files) &&
    !matchesAnyGlob(path, options.ignoredPaths ?? []) &&
    !path
      .split("/")
      .some((part) =>
        (options.ignoredDirectories ?? excludedDirectories).includes(part),
      )
  );
}

async function candidates(
  context: RuleContext<StdinRuleOptions>,
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

export function validateStdinArgs(id: string, args: string[]): void {
  for (const arg of args) {
    if (
      /^--(?:write|fix(?:-.*)?|cache(?:-.*)?|output-file|reporter|stdin(?:-.*)?|check|list-different|watch)(?:=|$)/.test(
        arg,
      ) ||
      ["-w", "-l", "-o", "-f", "--format", "--"].includes(arg)
    )
      throw new Error(
        `${id}: argument ${arg} conflicts with the read-only stdin protocol.`,
      );
  }
}
