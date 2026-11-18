import { createRequire } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type CheckConfig,
  type Diagnostic,
  type GeneratedArtifactDefinition,
  NodeProcessProvider,
  type ProcessExecOptions,
  type ProcessProvider,
} from "@slop-lab/qg-core";

type CheckCommand = Pick<ProcessExecOptions, "command" | "args" | "env">;
type TestCheck = Exclude<CheckConfig, { type?: "command" }>;
interface CheckAdapter {
  createCommand: (cwd: string, check: TestCheck) => CheckCommand;
  getArtifactDirectories?: (
    cwd: string,
    check: TestCheck,
    process: ProcessProvider,
  ) => Promise<string[]>;
}

async function loadAdapter(
  cwd: string,
  type: TestCheck["type"],
): Promise<CheckAdapter> {
  const packageName = `@slop-lab/qg-check-${type}`;
  const require = createRequire(resolve(cwd, "package.json"));
  let entry: string;
  try {
    entry = require.resolve(packageName);
  } catch (error) {
    throw new Error(
      `Check type ${type} requires ${packageName} in the project. Install it with npm install --save-dev ${packageName}.`,
      { cause: error },
    );
  }
  const module = (await import(pathToFileURL(entry).href)) as CheckAdapter;
  if (typeof module.createCommand !== "function")
    throw new Error(`${packageName} must export a createCommand function.`);
  return module;
}

export async function collectCheckArtifacts(
  root: string,
  checks: CheckConfig[],
  process: ProcessProvider = new NodeProcessProvider(),
): Promise<GeneratedArtifactDefinition[]> {
  const output = new Set<string>();
  for (const check of checks) {
    if (check.type !== "cargo") continue;
    const cwd = resolve(root, check.cwd ?? ".");
    try {
      const adapter = await loadAdapter(cwd, check.type);
      const directories = await adapter.getArtifactDirectories?.(
        cwd,
        check,
        process,
      );
      for (const directory of directories ?? []) {
        const path = relative(root, directory);
        if (
          path &&
          !isAbsolute(path) &&
          path !== ".." &&
          !path.startsWith(`..${sep}`) &&
          !/[*?:]/.test(path)
        )
          output.add(`${path.split(sep).join("/")}/**`);
      }
    } catch {
      // Missing or broken adapters are reported by runChecks.
    }
  }
  return output.size
    ? [{ id: "qg/cargo-output", files: [...output].sort() }]
    : [];
}

export async function runChecks(
  root: string,
  checks: CheckConfig[],
  process: ProcessProvider = new NodeProcessProvider(),
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const check of checks) {
    const diagnostic = (detail: string): Diagnostic => ({
      ruleId: `checks/${check.name}`,
      severity: "error",
      scope: "repo",
      message: `${check.name}: ${check.message ?? detail}`,
    });
    let invocation: CheckCommand | undefined;
    try {
      const cwd = check.cwd === undefined ? root : resolve(root, check.cwd);
      invocation =
        "command" in check
          ? { command: check.command, args: check.args ?? [] }
          : (await loadAdapter(cwd, check.type)).createCommand(cwd, check);
      const result = await process.exec({
        ...invocation,
        cwd,
        timeoutMs: check.timeoutMs ?? 120_000,
      });
      if (result.exitCode !== 0) {
        diagnostics.push({
          ...diagnostic(`command failed (exit ${result.exitCode}).`),
          metadata: {
            ...invocation,
            ...result,
          },
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        ...diagnostic(detail),
        metadata: {
          ...invocation,
          error: detail,
        },
      });
    }
  }
  return diagnostics;
}
