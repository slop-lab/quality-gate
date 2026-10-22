import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { type QualityGateConfig, runQualityGate } from "@slop-lab/qg-core";
import { createFixture, runRule } from "@slop-lab/qg-rule-test-utils";
import { maxBytesRule, maxLineLengthRule, maxLinesRule } from "./limits.js";

test("file limit rules report bytes, line length, and line count", async (t) => {
  const fixture = await createFixture({
    "src/large.txt": "123456\nsecond\nthird",
  });
  t.after(() => fixture.cleanup());

  for (const rule of [maxBytesRule, maxLineLengthRule, maxLinesRule]) {
    const result = await runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [rule],
      fs: fixture.fs,
      config: { rules: { [rule.metadata.id]: ["error", { limit: 2 }] } },
    });
    assert.equal(result.diagnostics.length > 0, true, rule.metadata.id);
    assert.equal(result.diagnostics[0]?.ruleId, rule.metadata.id);
  }
});

test("lockfiles are ignored by default and custom paths can be ignored", async (t) => {
  const fixture = await createFixture({
    "package-lock.json": "x".repeat(20),
    "generated/data.json": "x".repeat(20),
  });
  t.after(() => fixture.cleanup());

  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [maxBytesRule],
    fs: fixture.fs,
    config: {
      rules: {
        "files/max-bytes": [
          "error",
          { limit: 5, ignoredPaths: ["**/package-lock.json", "generated/**"] },
        ],
      },
    },
  });
  assert.deepEqual(result.diagnostics, []);
});

test("folder override can change a limit or disable a rule", async (t) => {
  const fixture = await createFixture({
    "src/index.ts": "123456",
    "generated/a.ts": "123456",
    "vendor/a.ts": "123456",
  });
  t.after(() => fixture.cleanup());

  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [maxLineLengthRule],
    fs: fixture.fs,
    config: {
      rules: { "files/max-line-length": ["error", { limit: 5 }] },
      overrides: [
        {
          files: ["generated/**"],
          rules: { "files/max-line-length": ["warning", { limit: 10 }] },
        },
        { files: ["vendor/**"], rules: { "files/max-line-length": "off" } },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["src/index.ts"],
  );
});

test("changed scans inspect only changed files", async (t) => {
  const fixture = await createFixture({ "a.txt": "123456", "b.txt": "123456" });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: maxLineLengthRule,
    mode: "changed",
    changes: [{ status: "modified", path: "a.txt" }],
  });
  assert.deepEqual(result.diagnostics, []);
});

for (const mode of ["full", "changed"] as const) {
  test(`line count boundaries emit one diagnostic at the right severity in ${mode} scans`, async (t) => {
    const fixture = await createFixture(
      Object.fromEntries(
        [0, 500, 501, 1000, 1001].map((count) => [
          `${count}.txt`,
          "x\n".repeat(count),
        ]),
      ),
    );
    t.after(() => fixture.cleanup());
    const result = await runQualityGate({
      root: fixture.root,
      mode,
      rules: [maxLinesRule],
      changedProvider: fixture.changedProvider(
        [0, 500, 501, 1000, 1001].map((count) => ({
          status: "added",
          path: `${count}.txt`,
        })),
      ),
    });
    assert.deepEqual(
      result.diagnostics.map((item) => [item.path, item.severity]),
      [
        ["1000.txt", "warning"],
        ["1001.txt", "error"],
        ["501.txt", "warning"],
      ],
    );
  });
}

test("line thresholds handle CRLF, final newlines, severity caps, and path overrides", async (t) => {
  const fixture = await createFixture({
    "warning.txt": "x\r\n".repeat(501),
    "error.txt": "x\n".repeat(1001).trimEnd(),
    "override.txt": "x\n".repeat(1001),
  });
  t.after(() => fixture.cleanup());
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [maxLinesRule],
    config: {
      rules: { "files/max-lines": "warning" },
      overrides: [
        {
          files: ["override.txt"],
          rules: {
            "files/max-lines": ["error", { limit: 2000, warningLimit: 1500 }],
          },
        },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.severity]),
    [
      ["error.txt", "warning"],
      ["warning.txt", "warning"],
    ],
  );
});

test("artifact classification exempts lockfiles across file limits and can be overridden per rule", async (t) => {
  const fixture = await createFixture({
    "package-lock.json": "x".repeat(30),
    "api/client.ts": "x".repeat(30),
    "source.ts": "x".repeat(30),
  });
  t.after(() => fixture.cleanup());
  const config: QualityGateConfig = {
    artifacts: { generated: { include: ["api/**"] } },
    rules: {
      "files/max-bytes": ["error", { limit: 2 }],
      "files/max-line-length": ["error", { limit: 2 }],
      "files/max-lines": ["error", { limit: 2 }],
    },
  };
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [maxBytesRule, maxLineLengthRule],
    config,
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["source.ts", "source.ts"],
  );
  const included = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [maxBytesRule],
    config: {
      ...config,
      overrides: [
        {
          files: ["package-lock.json"],
          rules: { "files/max-bytes": ["error", { includeGenerated: true }] },
        },
      ],
    },
  });
  assert.deepEqual(
    included.diagnostics.map((item) => item.path),
    ["package-lock.json", "source.ts"],
  );
});

test("staged line thresholds inspect index contents and generated inputs stay exempt", async (t) => {
  const fixture = await createFixture({
    "source.txt": "x\n".repeat(1001),
    "package-lock.json": "x\n".repeat(2000),
  });
  t.after(() => fixture.cleanup());
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: fixture.root });
  await exec("git", ["add", "."], { cwd: fixture.root });
  await fixture.write("source.txt", "short\n");
  const result = await runQualityGate({
    root: fixture.root,
    staged: true,
    rules: [maxLinesRule],
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.severity]),
    [["source.txt", "error"]],
  );
});
