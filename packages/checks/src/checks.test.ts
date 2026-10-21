import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ProcessExecOptions } from "@slop-lab/qg-core";
import { runChecks } from "./index.js";

test("shared checks run configured checks in order, collects all failures, and retains command output", async () => {
  const calls: ProcessExecOptions[] = [];
  const result = await runChecks(
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

test("node-test runs real tests with concise failure diagnostics and rejects unmatched files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-node-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "tests with spaces"));
  const file = join(root, "tests with spaces", "sample.test.mjs");
  await writeFile(
    file,
    `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('passing test', () => { console.log('hidden success log'); });
test('failing test', () => { console.log('failure context'); assert.equal(1, 2); });
`,
  );
  const check = {
    name: "tests",
    type: "node-test" as const,
    files: ["tests with spaces/*.test.mjs"],
  };
  const failed = await runChecks(root, [check]);
  assert.equal(failed.length, 1);
  assert.match(String(failed[0]?.metadata?.stdout), /FAIL failing test/);
  assert.match(String(failed[0]?.metadata?.stdout), /failure context/);
  assert.match(String(failed[0]?.metadata?.stdout), /AssertionError/);
  assert.doesNotMatch(String(failed[0]?.metadata?.stdout), /PASS|# tests|✔/);

  await writeFile(
    file,
    `import { test } from 'node:test'; test('pass', () => {});`,
  );
  assert.deepEqual(await runChecks(root, [check]), []);

  const unmatched = await runChecks(root, [
    { ...check, files: ["missing/*.test.mjs"] },
  ]);
  assert.match(unmatched[0]?.message ?? "", /No test files matched/);
});

test("node-test expands and deduplicates globs, uses the current Node runtime and configured timeout", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-node-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "one.test.mjs"), "");
  const calls: ProcessExecOptions[] = [];
  assert.deepEqual(
    await runChecks(
      root,
      [
        {
          name: "tests",
          type: "node-test",
          files: ["*.test.mjs", "one.test.mjs"],
          timeoutMs: 3000,
        },
      ],
      {
        async exec(options) {
          calls.push(options);
          return { exitCode: 0, stdout: "PASS\n", stderr: "" };
        },
      },
    ),
    [],
  );
  assert.equal(calls[0]?.command, process.execPath);
  assert.equal(calls[0]?.cwd, root);
  assert.equal(calls[0]?.timeoutMs, 3000);
  assert.equal(calls[0]?.args[0], "--test");
  assert.match(
    calls[0]?.args[1] ?? "",
    /--test-reporter=.*node-test-reporter\.js$/,
  );
  assert.deepEqual(calls[0]?.args.slice(2), [join(root, "one.test.mjs")]);
});
