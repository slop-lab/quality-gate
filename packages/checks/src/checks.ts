import { globSync } from "node:fs";
import { extname, resolve } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import {
  type CheckConfig,
  type Diagnostic,
  NodeProcessProvider,
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
    const command = check.type === "node-test" ? execPath : check.command;
    let args = check.type === "node-test" ? [] : (check.args ?? []);
    try {
      if (check.type === "node-test") {
        const files = new Set<string>();
        for (const pattern of check.files) {
          const matches = globSync(pattern, { cwd: root });
          if (!matches.length)
            throw new Error(`No test files matched: ${pattern}`);
          for (const match of matches) files.add(resolve(root, match));
        }
        const reporter = fileURLToPath(
          new URL(
            `./node-test-reporter${extname(fileURLToPath(import.meta.url))}`,
            import.meta.url,
          ),
        );
        args = ["--test", `--test-reporter=${reporter}`, ...[...files].sort()];
      }
      const result = await process.exec({
        command,
        args,
        cwd: root,
        timeoutMs: check.timeoutMs ?? 120_000,
        // A QG invocation from a Node test must start an independent test runner.
        ...(check.type === "node-test"
          ? { env: { NODE_TEST_CONTEXT: undefined } }
          : {}),
      });
      if (result.exitCode !== 0) {
        diagnostics.push({
          ...diagnostic(`command failed (exit ${result.exitCode}).`),
          metadata: {
            command,
            args,
            ...result,
          },
        });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        ...diagnostic(detail),
        metadata: {
          command,
          args,
          error: detail,
        },
      });
    }
  }
  return diagnostics;
}
