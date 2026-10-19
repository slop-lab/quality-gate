import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { type QualityGateConfig, runQualityGate } from "@slop-lab/qg-core";
import { createFixture } from "@slop-lab/qg-test-utils";
import { jsRules } from "./index.js";
import { allowedPackageNameRule } from "./package-name.js";

const policy: QualityGateConfig = {
  rules: {
    "package/allowed-name": [
      "error",
      {
        allowedPatterns: ["@slop-lab/qg(-.*)?", "@this-project/[^/]+"],
      },
    ],
  },
};

async function check(
  t: TestContext,
  files: Record<string, string>,
  options: Partial<Parameters<typeof runQualityGate>[0]> = {},
) {
  const fixture = await createFixture(files);
  t.after(() => fixture.cleanup());
  return runQualityGate({
    root: fixture.root,
    rules: [allowedPackageNameRule],
    config: policy,
    mode: "full",
    ...options,
  });
}

const manifest = (name: unknown) => JSON.stringify({ name });

test("package name rule is exported in jsRules and disabled by default", async (t) => {
  assert.ok(jsRules.includes(allowedPackageNameRule));
  const result = await check(
    t,
    { "package.json": manifest("unrelated") },
    { config: {} },
  );
  assert.deepEqual(result.diagnostics, []);
});

test("allows configured package names in root and nested manifests", async (t) => {
  const result = await check(t, {
    "package.json": manifest("@slop-lab/qg"),
    "packages/core/package.json": manifest("@slop-lab/qg-core"),
    "fixtures/app/package.json": manifest("@this-project/app"),
  });
  assert.deepEqual(result.diagnostics, []);
});

test("rejects unrelated names, partial matches, and invalid names", async (t) => {
  const names = [
    "app",
    "@slop-lab/qgother",
    "prefix@slop-lab/qg",
    "@other/qg",
    "@this-project/",
    "@this-project/app/extra",
    "@slop-lab/qg\n",
    "",
    42,
    null,
    undefined,
  ];
  const files = Object.fromEntries(
    names.map((name, index) => [
      `packages/${index}/package.json`,
      manifest(name),
    ]),
  );
  const result = await check(t, files);
  assert.equal(result.diagnostics.length, names.length);
  for (const diagnostic of result.diagnostics) {
    assert.equal(diagnostic.ruleId, "package/allowed-name");
    assert.equal(diagnostic.severity, "error");
    assert.match(diagnostic.message, /must match one of the allowed patterns/);
  }
});

test("reports malformed JSON and non-object manifests", async (t) => {
  const result = await check(t, {
    "package.json": "{",
    "packages/null/package.json": "null",
    "packages/string/package.json": '"name"',
  });
  assert.equal(result.diagnostics.length, 3);
  assert.match(result.diagnostics[0]?.message ?? "", /not valid JSON/);
});

test("changed scans check destination manifests and skip deletions and other files", async (t) => {
  const result = await check(
    t,
    {
      "package.json": manifest("invalid"),
      "packages/added/package.json": manifest("invalid"),
      "packages/renamed/package.json": manifest("invalid"),
      "packages/copied/package.json": manifest("invalid"),
      "packages/modified/package.json": manifest("invalid"),
    },
    {
      mode: "changed",
      changedProvider: {
        async getChanged() {
          return [
            { status: "added", path: "packages/added/package.json" },
            {
              status: "renamed",
              path: "packages/renamed/package.json",
              oldPath: "old/package.json",
            },
            { status: "copied", path: "packages/copied/package.json" },
            { status: "modified", path: "packages/modified/package.json" },
            { status: "deleted", path: "deleted/package.json" },
            { status: "modified", path: "README.md" },
          ];
        },
      },
    },
  );
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.path),
    [
      "packages/added/package.json",
      "packages/copied/package.json",
      "packages/modified/package.json",
      "packages/renamed/package.json",
    ],
  );
});

test("honors ignored paths, directories, generated artifacts, and path policies", async (t) => {
  const result = await check(
    t,
    {
      "package.json": manifest("@slop-lab/qg"),
      "node_modules/lib/package.json": manifest("invalid"),
      "dist/package.json": manifest("invalid"),
      "vendor/package.json": manifest("invalid"),
      "generated/package.json": manifest("invalid"),
      "disabled/package.json": manifest("invalid"),
      "custom/package.json": manifest("custom"),
    },
    {
      config: {
        artifacts: { generated: { include: ["generated/**"] } },
        rules: {
          "package/allowed-name": [
            "error",
            { allowedPatterns: ["@slop-lab/qg"], ignoredPaths: ["vendor/**"] },
          ],
        },
        overrides: [
          { files: ["disabled/**"], rules: { "package/allowed-name": "off" } },
          {
            files: ["custom/**"],
            rules: {
              "package/allowed-name": [
                "warning",
                { allowedPatterns: ["custom"] },
              ],
            },
          },
        ],
      },
    },
  );
  assert.deepEqual(result.diagnostics, []);
});

test("rejects all names with an empty allowlist and explains invalid regular expressions", async (t) => {
  const result = await check(
    t,
    { "package.json": manifest("@slop-lab/qg") },
    {
      config: { rules: { "package/allowed-name": "error" } },
    },
  );
  assert.equal(result.diagnostics.length, 1);
  await assert.rejects(
    check(
      t,
      { "package.json": manifest("@slop-lab/qg") },
      {
        config: {
          rules: {
            "package/allowed-name": ["error", { allowedPatterns: ["["] }],
          },
        },
      },
    ),
    /package\/allowed-name: invalid allowed pattern/,
  );
});
