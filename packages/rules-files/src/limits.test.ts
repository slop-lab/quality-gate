import assert from "node:assert/strict";
import { test } from "node:test";
import { runQualityGate } from "@quality-gate/core";
import { createFixture, runRule } from "@quality-gate/test-utils";
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
