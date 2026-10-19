import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProcessExecOptions } from "@slop-lab/qg-core";
import { runPreCommitChecks } from "./pre-commit.js";

test("pre-commit runs configured checks in order, collects all failures, and retains command output", async () => {
  const calls: ProcessExecOptions[] = [];
  const result = await runPreCommitChecks(
    "/project",
    [
      { name: "pass", command: "tool", args: ["check"] },
      {
        name: "fail",
        command: "tool",
        args: ["test"],
        message: "Run tests",
        timeoutMs: 5000,
      },
      { name: "missing", command: "missing" },
    ],
    {
      async exec(options) {
        calls.push(options);
        if (options.command === "missing")
          throw new Error("Executable not found");
        return {
          exitCode: options.args[0] === "test" ? 1 : 0,
          stdout: "details",
          stderr: "failure details",
        };
      },
    },
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.cwd, "/project");
  assert.equal(calls[0]?.timeoutMs, 120_000);
  assert.equal(calls[1]?.timeoutMs, 5000);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.message, "fail: Run tests");
  assert.equal(result[0]?.metadata?.stdout, "details");
  assert.equal(result[0]?.metadata?.stderr, "failure details");
  assert.match(result[1]?.message ?? "", /Executable not found/);
  assert.ok(result.every((diagnostic) => diagnostic.severity === "error"));
});
