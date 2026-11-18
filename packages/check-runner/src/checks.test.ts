import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import type { ProcessExecOptions } from "@slop-lab/qg-core";
import { NodeProcessProvider } from "@slop-lab/qg-core";
import { collectCheckArtifacts, runChecks } from "./index.js";

async function testProject(t: TestContext, ...types: string[]) {
  const root = await mkdtemp(join(tmpdir(), "qg-check-project-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scope = join(root, "node_modules", "@slop-lab");
  await mkdir(scope, { recursive: true });
  for (const type of types) {
    const name = `qg-check-${type}`;
    const manifest = createRequire(import.meta.url).resolve(
      `@slop-lab/${name}/package.json`,
    );
    await symlink(dirname(manifest), join(scope, name), "junction");
  }
  return root;
}

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
  const root = await testProject(t, "node-test");
  await mkdir(join(root, "tests with spaces"));
  await symlink(
    join(root, "tests with spaces"),
    join(root, "linked tests"),
    "junction",
  );
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
    files: ["linked tests/*.test.mjs"],
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
  const root = await testProject(t, "node-test");
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
    /--test-reporter=.*node-test-reporter\.m?js$/,
  );
  assert.deepEqual(calls[0]?.args.slice(2), [join(root, "one.test.mjs")]);
});

test("unittest discovers Python tests, retains failures, and rejects an empty suite", async (t) => {
  const python = process.platform === "win32" ? "python" : "python3";
  const provider = new NodeProcessProvider();
  try {
    await provider.exec({
      command: python,
      args: ["--version"],
      cwd: tmpdir(),
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
    t.skip(`${python} is unavailable`);
    return;
  }
  const root = await testProject(t, "unittest");
  await mkdir(join(root, "tests"));
  await writeFile(join(root, "tests", "__init__.py"), "");
  const file = join(root, "tests", "sample_test.py");
  const check = {
    name: "python-tests",
    type: "unittest" as const,
    python,
    pattern: "*_test.py",
    topLevelDirectory: ".",
  };
  const empty = await runChecks(root, [check]);
  assert.match(String(empty[0]?.metadata?.stderr), /No unittest tests found/);

  const writeTest = (assertion: string) =>
    writeFile(
      file,
      `import unittest

class SampleTest(unittest.TestCase):
    def test_example(self):
        self.assertEqual(1, ${assertion})

    def test_passing(self):
        self.assertTrue(True)
`,
    );
  await writeTest("2");
  const failed = await runChecks(root, [check]);
  assert.equal(failed[0]?.ruleId, "checks/python-tests");
  assert.match(String(failed[0]?.metadata?.stderr), /FAIL: test_example/);
  assert.match(String(failed[0]?.metadata?.stderr), /AssertionError: 1 != 2/);
  assert.doesNotMatch(String(failed[0]?.metadata?.stderr), /test_passing/);
  await writeTest("1");
  assert.deepEqual(await runChecks(root, [check]), []);
});

test("Jest and Cargo load their adapters from the check project only when selected", async (t) => {
  const root = await testProject(t, "jest", "cargo");
  const jest = join(root, "node_modules", "jest");
  await mkdir(jest, { recursive: true });
  await writeFile(
    join(jest, "package.json"),
    JSON.stringify({ bin: "./jest.js" }),
  );
  const entry = join(jest, "jest.js");
  await writeFile(entry, "");
  const calls: ProcessExecOptions[] = [];
  const diagnostics = await runChecks(
    root,
    [
      {
        name: "jest",
        type: "jest",
        args: ["--config", "config with spaces.js"],
      },
      {
        name: "cargo",
        type: "cargo",
        args: ["--workspace", "--", "--test-threads=1"],
      },
      { name: "python", type: "unittest" },
    ],
    {
      async exec(options) {
        calls.push(options);
        return { exitCode: 0, stdout: "hidden success", stderr: "" };
      },
    },
  );
  assert.deepEqual(
    calls.map(({ command, args }) => [command, args]),
    [
      [process.execPath, [entry, "--ci", "--config", "config with spaces.js"]],
      ["cargo", ["test", "--workspace", "--", "--test-threads=1"]],
    ],
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.ruleId, "checks/python");
  assert.match(
    diagnostics[0]?.message ?? "",
    /requires @slop-lab\/qg-check-unittest/,
  );

  await rm(jest, { recursive: true });
  const missingJest = await runChecks(root, [{ name: "jest", type: "jest" }]);
  assert.match(missingJest[0]?.message ?? "", /Install jest in the project/);
});

test("Vitest resolves the adapter and executable from the check working directory", async (t) => {
  const root = await testProject(t);
  const cwd = join(root, "web app");
  const scope = join(cwd, "node_modules", "@slop-lab");
  const manifest = createRequire(import.meta.url).resolve(
    "@slop-lab/qg-check-vitest/package.json",
  );
  await mkdir(scope, { recursive: true });
  await symlink(dirname(manifest), join(scope, "qg-check-vitest"), "junction");
  const packagePath = join(cwd, "node_modules", "vitest");
  await mkdir(packagePath);
  await writeFile(
    join(packagePath, "package.json"),
    JSON.stringify({ bin: { vitest: "./cli.mjs" } }),
  );
  const calls: ProcessExecOptions[] = [];
  const diagnostics = await runChecks(
    root,
    [
      {
        name: "web",
        type: "vitest",
        cwd: "web app",
        args: ["--project", "unit"],
      },
    ],
    {
      async exec(options) {
        calls.push(options);
        return { exitCode: 0, stdout: "hidden success", stderr: "" };
      },
    },
  );
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(calls, [
    {
      cwd,
      command: process.execPath,
      args: [join(packagePath, "cli.mjs"), "run", "--project", "unit"],
      timeoutMs: 120_000,
    },
  ]);
});

test("Cargo artifact discovery uses the check directory, native configuration and explicit target override", async (t) => {
  const root = await testProject(t, "cargo");
  const cwd = join(root, "rust");
  const calls: ProcessExecOptions[] = [];
  const artifacts = await collectCheckArtifacts(
    root,
    [
      {
        name: "rust",
        type: "cargo",
        cwd: "rust",
        args: [
          "--manifest-path=app/Cargo.toml",
          "--config",
          "settings.toml",
          "--target-dir",
          "../build output",
          "--",
          "--target-dir",
          "ignored",
        ],
      },
    ],
    {
      async exec(options) {
        calls.push(options);
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            target_directory: join(cwd, "metadata-target"),
            build_directory: join(cwd, "intermediate"),
          }),
          stderr: "",
        };
      },
    },
  );
  assert.deepEqual(calls, [
    {
      command: "cargo",
      cwd,
      args: [
        "metadata",
        "--format-version",
        "1",
        "--no-deps",
        "--offline",
        "--manifest-path",
        "app/Cargo.toml",
        "--config",
        "settings.toml",
      ],
      env: { CARGO_TARGET_DIR: join(root, "build output") },
      timeoutMs: 10_000,
    },
  ]);
  assert.deepEqual(artifacts, [
    {
      id: "qg/cargo-output",
      files: ["build output/**", "rust/intermediate/**"],
    },
  ]);
});
