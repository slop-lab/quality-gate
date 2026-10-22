import { globSync } from "node:fs";
import { extname, resolve } from "node:path";
import { execPath } from "node:process";
import { fileURLToPath } from "node:url";
import type { CheckConfig, ProcessExecOptions } from "@slop-lab/qg-core";
export type NodeTestCheckConfig = Extract<CheckConfig, { type: "node-test" }>;
/** Prepare an isolated Node test invocation; the caller owns execution and diagnostics. */
export function createNodeTestCommand(
  root: string,
  check: NodeTestCheckConfig,
): Pick<ProcessExecOptions, "command" | "args" | "env"> {
  const files = new Set<string>();
  for (const pattern of check.files) {
    const matches = globSync(pattern, { cwd: root });
    if (!matches.length) throw new Error(`No test files matched: ${pattern}`);
    for (const match of matches) files.add(resolve(root, match));
  }
  const reporter = fileURLToPath(
    new URL(
      `./reporter${extname(fileURLToPath(import.meta.url))}`,
      import.meta.url,
    ),
  );
  return {
    command: execPath,
    args: ["--test", `--test-reporter=${reporter}`, ...[...files].sort()],
    env: { NODE_TEST_CONTEXT: undefined },
  };
}
