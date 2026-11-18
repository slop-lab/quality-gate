import { execPath } from "node:process";
import {
  type CheckConfig,
  type ProcessExecOptions,
  resolveNodePackageBinary,
} from "@slop-lab/qg-core";

export function createCommand(
  root: string,
  check: Extract<CheckConfig, { type: "vitest" }>,
): Pick<ProcessExecOptions, "command" | "args"> {
  const entry = resolveNodePackageBinary(root, "vitest");
  return { command: execPath, args: [entry, "run", ...(check.args ?? [])] };
}
