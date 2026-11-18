import { platform } from "node:process";
import type { CheckConfig, ProcessExecOptions } from "@slop-lab/qg-core";

// Older Python versions exit successfully when discovery finds no tests.
const discoverUnittest = `
import sys
import unittest

start, pattern, top = sys.argv[1:]
suite = unittest.defaultTestLoader.discover(start, pattern, top or None)
if not suite.countTestCases():
    sys.exit("No unittest tests found in {!r} matching {!r}".format(start, pattern))
result = unittest.TextTestRunner(verbosity=0).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
`;

export function createCommand(
  _root: string,
  check: Extract<CheckConfig, { type: "unittest" }>,
): Pick<ProcessExecOptions, "command" | "args"> {
  return {
    command: check.python ?? (platform === "win32" ? "python" : "python3"),
    args: [
      "-B",
      "-c",
      discoverUnittest,
      check.startDirectory ?? "tests",
      check.pattern ?? "test*.py",
      check.topLevelDirectory ?? "",
    ],
  };
}
