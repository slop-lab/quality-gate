import { execPath } from "node:process";
import {
  type CheckConfig,
  type ProcessExecOptions,
  resolveNodePackageBinary,
} from "@slop-lab/qg-core";

export function createCommand(
  root: string,
  check: Extract<CheckConfig, { type: "jest" }>,
): Pick<ProcessExecOptions, "command" | "args"> {
  const entry = resolveNodePackageBinary(root, "jest");
  return { command: execPath, args: [entry, "--ci", ...(check.args ?? [])] };
}
