import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ProcessProvider } from "@slop-lab/qg-core";
import {
  assertDiagnostic,
  createFixture,
  runRule,
} from "@slop-lab/qg-test-utils";
import { noNpmLockWithPnpmRule, pnpmLockfileIsCurrentRule } from "./rules.js";

test("reports package-lock.json when pnpm workspace is present", async (t) => {
  const fixture = await createPnpmFixture({ "package-lock.json": "{}\n" });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: noNpmLockWithPnpmRule,
    mode: "full",
  });

  assert.equal(result.diagnostics.length, 1);
  assertDiagnostic(result.diagnostics[0], {
    ruleId: "package-manager/no-npm-lock-with-pnpm",
    severity: "error",
    path: "package-lock.json",
    scope: "repo",
  });
});

test("changed scan only checks npm lock rule for relevant changes", async (t) => {
  const fixture = await createPnpmFixture({ "package-lock.json": "{}\n" });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: noNpmLockWithPnpmRule,
    mode: "changed",
    changes: [{ status: "modified", path: "README.md" }],
  });

  assert.equal(result.diagnostics.length, 0);
});

test("changed scan reports npm lock rule when package-lock.json changed", async (t) => {
  const fixture = await createPnpmFixture({ "package-lock.json": "{}\n" });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: noNpmLockWithPnpmRule,
    mode: "changed",
    changes: [{ status: "added", path: "package-lock.json" }],
  });

  assert.equal(result.diagnostics.length, 1);
});

test("pnpm lockfile rule passes when pnpm leaves lockfile unchanged", async (t) => {
  const fixture = await createPnpmFixture();
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: pnpmLockfileIsCurrentRule,
    mode: "full",
    process: noOpProcess,
  });

  assert.equal(result.diagnostics.length, 0);
});

test("pnpm lockfile rule reports when pnpm rewrites lockfile", async (t) => {
  const fixture = await createPnpmFixture();
  t.after(() => fixture.cleanup());

  const process: ProcessProvider = {
    async exec(options) {
      await writeFile(
        join(options.cwd, "pnpm-lock.yaml"),
        "lockfileVersion: '10.0'\nrewritten: true\n",
      );
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };

  const result = await runRule({
    fixture,
    rule: pnpmLockfileIsCurrentRule,
    mode: "full",
    process,
  });

  assert.equal(result.diagnostics.length, 1);
  assertDiagnostic(result.diagnostics[0], {
    ruleId: "pnpm/lockfile-is-current",
    severity: "error",
    path: "pnpm-lock.yaml",
    scope: "repo",
  });
});

test("changed scan only checks pnpm lockfile rule for relevant changes", async (t) => {
  const fixture = await createPnpmFixture();
  t.after(() => fixture.cleanup());
  let calls = 0;

  const process: ProcessProvider = {
    async exec() {
      calls += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };

  const result = await runRule({
    fixture,
    rule: pnpmLockfileIsCurrentRule,
    mode: "changed",
    changes: [{ status: "modified", path: "README.md" }],
    process,
  });

  assert.equal(result.diagnostics.length, 0);
  assert.equal(calls, 0);
});

const noOpProcess: ProcessProvider = {
  async exec() {
    return { exitCode: 0, stdout: "", stderr: "" };
  },
};

function createPnpmFixture(files: Record<string, string> = {}) {
  return createFixture({
    "package.json": JSON.stringify({ name: "fixture", private: true }, null, 2),
    "pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
    "pnpm-lock.yaml": "lockfileVersion: '10.0'\n",
    "packages/app/package.json": JSON.stringify(
      { name: "app", version: "0.0.0" },
      null,
      2,
    ),
    ...files,
  });
}
