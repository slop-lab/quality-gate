import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type CheckConfig,
  type Diagnostic,
  NodeProcessProvider,
  type ProcessExecOptions,
  type ProcessProvider,
} from "@slop-lab/qg-core";

type CheckCommand = Pick<ProcessExecOptions, "command" | "args" | "env">;
type TestCheck = Exclude<CheckConfig, { type?: "command" }>;

async function createCheckCommand(
  root: string,
  check: CheckConfig,
): Promise<CheckCommand> {
  if ("command" in check)
    return { command: check.command, args: check.args ?? [] };
  const packageName = `@slop-lab/qg-check-${check.type}`;
  const require = createRequire(resolve(root, "package.json"));
  let entry: string;
  try {
    entry = require.resolve(packageName);
  } catch (error) {
    throw new Error(
      `Check type ${check.type} requires ${packageName} in the project. Install it with npm install --save-dev ${packageName}.`,
      { cause: error },
    );
  }
  const module = (await import(pathToFileURL(entry).href)) as {
    createCommand?: (root: string, check: TestCheck) => CheckCommand;
  };
  if (typeof module.createCommand !== "function")
    throw new Error(`${packageName} must export a createCommand function.`);
  return module.createCommand(root, check);
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
      invocation = await createCheckCommand(root, check);
      const result = await process.exec({
        ...invocation,
        cwd: root,
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
