import { createNodeTestCommand } from "@slop-lab/qg-check-node-test";
import {
  type CheckConfig,
  type Diagnostic,
  NodeProcessProvider,
  type ProcessExecOptions,
  type ProcessProvider,
} from "@slop-lab/qg-core";

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
    let invocation:
      | Pick<ProcessExecOptions, "command" | "args" | "env">
      | undefined;
    try {
      invocation =
        check.type === "node-test"
          ? createNodeTestCommand(root, check)
          : { command: check.command, args: check.args ?? [] };
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
