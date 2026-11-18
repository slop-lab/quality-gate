import { createRequire } from "node:module";
import { resolve } from "node:path";
import { execPath } from "node:process";
import type { CheckConfig, ProcessExecOptions } from "@slop-lab/qg-core";

export function createCommand(
  root: string,
  check: Extract<CheckConfig, { type: "jest" }>,
): Pick<ProcessExecOptions, "command" | "args"> {
  const require = createRequire(resolve(root, "package.json"));
  let entry: string;
  try {
    entry = require.resolve("jest/bin/jest");
  } catch (error) {
    throw new Error("Jest is unavailable. Install jest in the project.", {
      cause: error,
    });
  }
  return { command: execPath, args: [entry, "--ci", ...(check.args ?? [])] };
}
