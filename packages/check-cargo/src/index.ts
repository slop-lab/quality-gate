import type { CheckConfig, ProcessExecOptions } from "@slop-lab/qg-core";

export function createCommand(
  _root: string,
  check: Extract<CheckConfig, { type: "cargo" }>,
): Pick<ProcessExecOptions, "command" | "args"> {
  return { command: "cargo", args: ["test", ...(check.args ?? [])] };
}
