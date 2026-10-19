import assert from "node:assert/strict";
import { test } from "node:test";
import { type QualityGateConfig, runQualityGate } from "@slop-lab/qg-core";
import { jsRules } from "@slop-lab/qg-rules-js";
import { testRules } from "@slop-lab/qg-rules-test";
import { createFixture } from "@slop-lab/qg-test-utils";
import { recommendedRules } from "./index.js";

const allRules = [...recommendedRules, ...jsRules, ...testRules];

const off = Object.fromEntries(
  allRules.map((rule) => [rule.metadata.id, "off" as const]),
);

test("generated artifacts skip all built-in content checks and never launch external tools", async (t) => {
  const fixture = await createFixture({
    "api/client.js": "const x=1;".repeat(100),
    "api/README.md":
      "\u201c missing/file <!-- qg-suppress docs/valid-reference -->\n".repeat(
        20,
      ),
    "api/client.test.ts": "createFixtureFromDirectory('data');\n",
    "package-lock.json": "x".repeat(1000),
  });
  t.after(() => fixture.cleanup());
  const rules = { ...off } as NonNullable<QualityGateConfig["rules"]>;
  for (const rule of allRules.filter(
    (rule) => rule.metadata.ignoreGeneratedArtifacts,
  ))
    rules[rule.metadata.id] = "error";
  for (const id of [
    "files/max-bytes",
    "files/max-line-length",
    "files/max-lines",
  ])
    rules[id] = ["error", { limit: 2, warningLimit: 1 }];
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: allRules,
    config: { artifacts: { generated: { include: ["api/**"] } }, rules },
    process: {
      async exec() {
        assert.fail(
          "Generated inputs must be skipped before process discovery or invocation",
        );
      },
    },
  });
  assert.deepEqual(result.diagnostics, []);
});

test("project source exceptions and per-rule opt-in apply across JS and Markdown checks", async (t) => {
  const fixture = await createFixture({
    "api/handwritten.js": "const x=1;",
    "api/generated.js": "const x=1;",
    "api/doc.md": "\u201c missing/file <!-- qg-suppress unrelated/rule -->",
  });
  t.after(() => fixture.cleanup());
  const ids = [
    "docs/valid-reference",
    "markdown/allowed-characters",
    "qg/require-suppression-reason",
    "js/require-ts-check",
  ];
  const config: QualityGateConfig = {
    artifacts: {
      generated: { include: ["api/**"], exclude: ["api/handwritten.js"] },
    },
    rules: { ...off, ...Object.fromEntries(ids.map((id) => [id, "error"])) },
    overrides: [
      {
        files: ["api/doc.md"],
        rules: Object.fromEntries(
          ids.map((id) => [id, ["error", { includeGenerated: true }]]),
        ),
      },
    ],
  };
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: allRules,
    config,
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.ruleId),
    ids,
  );
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["api/doc.md", "api/doc.md", "api/doc.md", "api/handwritten.js"],
  );
});

test("generated targets remain visible to document references and package manager integrity checks", async (t) => {
  const fixture = await createFixture({
    "api/client": "generated",
    "README.md": "api/client",
    "pnpm-workspace.yaml": "packages: []\n",
    "package-lock.json": "x".repeat(2000),
  });
  t.after(() => fixture.cleanup());
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: allRules,
    config: {
      artifacts: { generated: { include: ["api/**", "pnpm-workspace.yaml"] } },
      rules: {
        ...off,
        "docs/valid-reference": "error",
        "files/max-bytes": ["error", { limit: 1000 }],
        "package-manager/no-npm-lock-with-pnpm": "error",
      },
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.ruleId, item.path]),
    [["package-manager/no-npm-lock-with-pnpm", "package-lock.json"]],
  );
});
