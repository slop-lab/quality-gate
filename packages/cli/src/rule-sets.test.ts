import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import { recommendedRules } from "@slop-lab/qg-rules-recommended";
import { loadRules } from "./rule-sets.js";

async function project(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "qg-presets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function install(root: string, name: string) {
  const target = join(root, "node_modules", "@slop-lab");
  await mkdir(target, { recursive: true });
  await symlink(
    dirname(
      createRequire(import.meta.url).resolve(`@slop-lab/${name}/package.json`),
    ),
    join(target, name),
    "junction",
  );
}

test("default recommendations are independent of JS and test packages even when they are installed", async (t) => {
  const root = await project(t);
  assert.deepEqual(await loadRules(root), recommendedRules);
  await install(root, "qg-rules-js");
  assert.deepEqual(await loadRules(root), recommendedRules);
  const ids = recommendedRules.map((rule) => rule.metadata.id);
  assert.ok(
    !ids.some((id) =>
      /^(js|package|package-manager|pnpm|external|test)\//.test(id),
    ),
  );
});

test("presets load separately installed project packages once and keep the recommendation list unchanged", async (t) => {
  const root = await project(t);
  await install(root, "qg-rules-js");
  const before = [...recommendedRules];
  const loaded = await loadRules(root, {
    presets: ["js-directives", "js-test-fixtures", "js-directives"],
  });
  const ids = loaded.map((rule) => rule.metadata.id);
  assert.ok(ids.includes("js/require-ts-check"));
  assert.ok(!ids.includes("package/allowed-name"));
  assert.ok(!ids.includes("pnpm/lockfile-is-current"));
  assert.ok(ids.includes("test/no-directory-fixture-copy"));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(recommendedRules, before);
});

test("missing preset packages and enabled rules from unloaded presets fail with installation guidance", async (t) => {
  const root = await project(t);
  await assert.rejects(
    loadRules(root, { presets: ["js-directives"] }),
    /npm install --save-dev @slop-lab\/qg-rules-js/,
  );
  await assert.rejects(
    loadRules(root, { rules: { "js/require-ts-check": "error" } }),
    /Rule js\/require-ts-check is not loaded/,
  );
  await assert.rejects(
    loadRules(root, {
      overrides: [
        {
          files: ["**"],
          rules: { "test/no-directory-fixture-copy": "warning" },
        },
      ],
    }),
    /is not loaded/,
  );
  assert.deepEqual(
    await loadRules(root, { rules: { "js/require-ts-check": "off" } }),
    recommendedRules,
  );
});

const customRuleSource = `({ metadata: {
  id: 'project/custom', name: 'Custom', description: 'Custom rule', defaultSeverity: 'error',
  defaultEnabled: false, supports: ['changed', 'full'], scope: 'file', requires: [], fixable: 'none',
}, async check() { return []; } })`;

test("custom rule modules load relative to the project root or from project packages", async (t) => {
  const root = await project(t);
  await writeFile(
    join(root, "custom.mjs"),
    `export const rules = [${customRuleSource}];`,
  );
  const loaded = await loadRules(root, {
    ruleModules: ["./custom.mjs", "./custom.mjs"],
    rules: { "project/custom": "error" },
  });
  assert.equal(
    loaded.filter((rule) => rule.metadata.id === "project/custom").length,
    1,
  );
  const directory = join(root, "node_modules", "custom-rules");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      name: "custom-rules",
      type: "module",
      exports: "./index.mjs",
    }),
  );
  await writeFile(
    join(directory, "index.mjs"),
    `export default [${customRuleSource}];`,
  );
  assert.ok(
    (await loadRules(root, { ruleModules: ["custom-rules"] })).some(
      (rule) => rule.metadata.id === "project/custom",
    ),
  );
});

test("custom rule modules reject missing modules, invalid exports and duplicate rule IDs", async (t) => {
  const root = await project(t);
  await assert.rejects(
    loadRules(root, { ruleModules: ["./missing.mjs"] }),
    /Cannot load rule module.*missing/,
  );
  const invalid = [
    "export default {};",
    "export const rules = [{}];",
    `export const rules = [{...${customRuleSource}, metadata: { id: 'bad' }}];`,
    "throw new Error('module init failure');",
  ];
  for (const [index, source] of invalid.entries()) {
    await writeFile(join(root, `invalid-${index}.mjs`), source);
    await assert.rejects(
      loadRules(root, { ruleModules: [`./invalid-${index}.mjs`] }),
      /must export a rules array|Cannot load rule module.*module init failure/,
    );
  }
  await writeFile(
    join(root, "duplicate.mjs"),
    `export const rules = [${customRuleSource}, ${customRuleSource}];`,
  );
  await assert.rejects(
    loadRules(root, { ruleModules: ["./duplicate.mjs"] }),
    /Duplicate rule ID: project\/custom/,
  );
});

test("CLI modules can export named or default providers and execute their discovered rules", async (t) => {
  const root = await project(t);
  for (const declaration of ["export const ruleProvider =", "export default"]) {
    const file = declaration.includes("const")
      ? "provider.mjs"
      : "default-provider.mjs";
    await writeFile(
      join(root, file),
      `${declaration} {
      getRules() { return [${customRuleSource}.metadata]; },
      async execute(request) { return { diagnostics: [{ ruleId: request.ruleId, severity: request.severity, scope: 'repo', message: request.mode }] }; },
    };`,
    );
    const rules = await loadRules(root, { ruleModules: [`./${file}`] });
    const rule = rules.find((rule) => rule.metadata.id === "project/custom");
    assert.ok(rule);
    const { runQualityGate } = await import("@slop-lab/qg-core");
    const result = await runQualityGate({
      root,
      mode: "full",
      rules: [rule],
      config: { rules: { "project/custom": "error" } },
    });
    assert.equal(result.diagnostics[0]?.message, "full");
  }
  await writeFile(
    join(root, "invalid-provider.mjs"),
    "export const ruleProvider = { getRules: () => [{}], execute: async () => ({ diagnostics: [] }) };",
  );
  await assert.rejects(
    loadRules(root, { ruleModules: ["./invalid-provider.mjs"] }),
    /Invalid rule provider.*valid rule metadata/,
  );
});

test("tool-specific modules load without JS or JS test presets and only register the selected adapter", async (t) => {
  const root = await project(t);
  for (const tool of ["biome", "prettier", "eslint"]) {
    await install(root, `qg-rules-${tool}`);
    const rules = await loadRules(root, {
      ruleModules: [`@slop-lab/qg-rules-${tool}`],
      rules: { [`external/${tool}`]: "error" },
    });
    assert.deepEqual(
      rules
        .filter((rule) => rule.metadata.id.startsWith("external/"))
        .map((rule) => rule.metadata.id),
      [`external/${tool}`],
    );
    assert.ok(!rules.some((rule) => rule.metadata.id.startsWith("js/")));
    assert.ok(!rules.some((rule) => rule.metadata.id.startsWith("test/")));
  }
  await install(root, "qg-rules-js");
  const js = await loadRules(root, { presets: ["js-directives"] });
  assert.ok(!js.some((rule) => rule.metadata.id.startsWith("external/")));
});

test("the combined JS preset contains all JS ecosystem policies and overlapping selections load each rule once", async (t) => {
  const root = await project(t);
  await install(root, "qg-rules-js");
  const rules = await loadRules(root, {
    presets: ["js", "js-directives", "js-test-fixtures", "js"],
  });
  const ids = rules.map((rule) => rule.metadata.id);
  for (const id of [
    "js/require-ts-check",
    "test/no-directory-fixture-copy",
    "package/allowed-name",
    "package-manager/no-npm-lock-with-pnpm",
    "pnpm/lockfile-is-current",
  ])
    assert.ok(ids.includes(id));
  assert.equal(new Set(ids).size, ids.length);
  const fromModule = await loadRules(root, {
    ruleModules: ["@slop-lab/qg-rules-js"],
  });
  assert.deepEqual(
    fromModule.map((rule) => rule.metadata.id),
    ids,
  );
  const directives = await loadRules(root, { presets: ["js-directives"] });
  assert.ok(
    !directives.some((rule) =>
      /^(test|package|pnpm|package-manager)\//.test(rule.metadata.id),
    ),
  );
});
