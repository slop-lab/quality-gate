import assert from "node:assert/strict";
import { test } from "node:test";
import { GeneratedArtifactRegistry } from "./artifacts.js";
import { runQualityGate } from "./runner.js";
import type { Rule } from "./types.js";

test("generated classifications cover root and nested artifacts and allow explicit source exceptions", () => {
  const registry = new GeneratedArtifactRegistry([], {
    include: ["generated/**"],
    exclude: ["generated/handwritten.ts"],
  });
  for (const path of [
    "package-lock.json",
    "packages/app/pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "build.tsbuildinfo",
    "app.min.js",
    "app.js.map",
    "generated/client.ts",
  ])
    assert.equal(registry.isGenerated(path), true, path);
  for (const path of ["package.json", "README.md", "generated/handwritten.ts"])
    assert.equal(registry.isGenerated(path), false, path);
  assert.equal(registry.isGenerated(".\\packages\\app\\pnpm-lock.yaml"), true);
  assert.equal(
    new GeneratedArtifactRegistry([], { defaults: false }).isGenerated(
      "package-lock.json",
    ),
    false,
  );
  assert.deepEqual(
    registry.matching("app.min.js").map((item) => item.id),
    ["qg/minified"],
  );
});

test("plugin contributions are copied, deduplicated by id, and retain per-provider exceptions", () => {
  const definition = {
    id: "example/codegen",
    files: ["api/**"],
    excludedFiles: ["api/manual.ts"],
  };
  const registry = new GeneratedArtifactRegistry([
    definition,
    { ...definition },
  ]);
  definition.files.push("src/**");
  assert.equal(registry.isGenerated("api/client.ts"), true);
  assert.equal(registry.isGenerated("api/manual.ts"), false);
  assert.equal(registry.isGenerated("src/main.ts"), false);
  registry.matching("api/client.ts")[0]?.files.push("src/**");
  assert.equal(registry.isGenerated("src/main.ts"), false);
  assert.throws(
    () =>
      new GeneratedArtifactRegistry([
        definition,
        { id: definition.id, files: ["different/**"] },
      ]),
    /Conflicting/,
  );
  assert.throws(
    () => new GeneratedArtifactRegistry([], { include: ["../outside/**"] }),
    /project-relative/,
  );
});

function fixtureRule(
  id: string,
  inspect: (context: Parameters<Rule["check"]>[0]) => void,
): Rule {
  return {
    metadata: {
      id,
      name: id,
      description: id,
      defaultSeverity: "error",
      supports: ["full"],
      scope: "file",
      requires: [],
      fixable: "none",
      ignoreGeneratedArtifacts: true,
    },
    async check(context) {
      inspect(context);
      return [];
    },
  };
}

test("disabled extension rules contribute artifacts before consumers execute in either rule order", async () => {
  const provider = fixtureRule("plugin/provider", () =>
    assert.fail("Disabled provider must not execute"),
  );
  provider.metadata.defaultEnabled = false;
  provider.metadata.generatedArtifacts = [
    { id: "plugin/generated", files: ["sdk/**"] },
  ];
  const consumer = fixtureRule("plugin/content", (context) => {
    assert.equal(context.artifacts.isGenerated("sdk/client.ts"), true);
    assert.equal(context.resolveConfig("sdk/client.ts").enabled, false);
    assert.equal(context.resolveConfig("source/main.ts").enabled, true);
  });
  for (const rules of [
    [consumer, provider],
    [provider, consumer],
  ])
    await runQualityGate({ root: ".", mode: "full", rules });
});

test("runner accepts embedding contributions, honors path opt-in, and keeps targeted policies active", async () => {
  const consumer = fixtureRule("plugin/content", (context) => {
    assert.equal(context.resolveConfig("sdk/a.ts").enabled, false);
    assert.equal(context.resolveConfig("sdk/check.ts").enabled, true);
    assert.equal(context.resolveConfig("source/handwritten.ts").enabled, true);
  });
  const targeted = fixtureRule("plugin/integrity", (context) =>
    assert.equal(context.resolveConfig("sdk/a.ts").enabled, true),
  );
  targeted.metadata.ignoreGeneratedArtifacts = false;
  await runQualityGate({
    root: ".",
    mode: "full",
    rules: [consumer, targeted],
    generatedArtifacts: [{ id: "host/generated", files: ["sdk/**"] }],
    config: {
      artifacts: {
        generated: {
          include: ["source/**"],
          exclude: ["source/handwritten.ts"],
        },
      },
      overrides: [
        {
          files: ["sdk/check.ts"],
          rules: { "plugin/content": ["error", { includeGenerated: true }] },
        },
      ],
    },
  });
});

test("runner filters generated diagnostics from an extension that omitted its early eligibility check", async () => {
  const rule = fixtureRule("plugin/content", () => {});
  rule.check = async () => [
    {
      ruleId: rule.metadata.id,
      severity: "error",
      message: "generated",
      path: "package-lock.json",
      scope: "file",
    },
  ];
  assert.deepEqual(
    (await runQualityGate({ root: ".", mode: "full", rules: [rule] }))
      .diagnostics,
    [],
  );
});
