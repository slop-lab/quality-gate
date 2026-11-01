import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixture, runRule } from "@slop-lab/qg-rule-testing";
import { noIgnoredTrackedFilesRule } from "./ignored-tracked.js";

test("reports tracked files matched by standard Git ignore rules", async (t) => {
  const fixture = await createFixture({});
  t.after(() => fixture.cleanup());
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const result = await runRule({
    fixture,
    rule: noIgnoredTrackedFilesRule,
    mode: "changed",
    changes: [{ status: "modified", path: ".gitignore" }],
    process: {
      async exec(options) {
        calls.push(options);
        return {
          exitCode: 0,
          stdout: "generated/output.js\0secrets/token\0",
          stderr: "",
        };
      },
    },
  });
  assert.deepEqual(calls, [
    {
      command: "git",
      args: ["ls-files", "-ci", "--exclude-standard", "-z"],
      cwd: fixture.root,
    },
  ]);
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["generated/output.js", "secrets/token"],
  );
});

test("supports explicit exceptions for intentionally ignored tracked files", async (t) => {
  const fixture = await createFixture({});
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: noIgnoredTrackedFilesRule,
    options: { ignoredPaths: ["fixtures/**"] },
    process: {
      async exec() {
        return {
          exitCode: 0,
          stdout: "fixtures/ignored.txt\0dist/bundle.js\0",
          stderr: "",
        };
      },
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["dist/bundle.js"],
  );
});

test("surfaces Git failures", async (t) => {
  const fixture = await createFixture({});
  t.after(() => fixture.cleanup());
  await assert.rejects(
    runRule({
      fixture,
      rule: noIgnoredTrackedFilesRule,
      process: {
        async exec() {
          return { exitCode: 128, stdout: "", stderr: "not a repository" };
        },
      },
    }),
    /git ls-files failed: not a repository/,
  );
});
