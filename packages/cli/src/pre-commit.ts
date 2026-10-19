import {
  type Diagnostic,
  NodeProcessProvider,
  type PreCommitCheck,
  type ProcessProvider,
} from "@slop-lab/qg-core";

export async function runPreCommitChecks(
  root: string,
  checks: PreCommitCheck[],
  process: ProcessProvider = new NodeProcessProvider(),
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const check of checks) {
    const diagnostic = (detail: string): Diagnostic => ({
      ruleId: "hooks/pre-commit",
      severity: "error",
      scope: "repo",
      message: `${check.name}: ${check.message ?? detail}`,
    });
    try {
      const result = await process.exec({
        command: check.command,
        args: check.args ?? [],
        cwd: root,
        timeoutMs: check.timeoutMs ?? 120_000,
      });
      if (result.exitCode !== 0) {
        diagnostics.push({
          ...diagnostic(`command failed (exit ${result.exitCode}).`),
          metadata: {
            command: check.command,
            args: check.args ?? [],
            ...result,
          },
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        ...diagnostic(detail),
        metadata: {
          command: check.command,
          args: check.args ?? [],
          error: detail,
        },
      });
    }
  }
  return diagnostics;
}
