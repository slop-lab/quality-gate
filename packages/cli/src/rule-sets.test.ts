import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
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
  await install(root, "qg-rules-test");
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
  await install(root, "qg-rules-test");
  const before = [...recommendedRules];
  const loaded = await loadRules(root, { presets: ["js", "test", "js"] });
  const ids = loaded.map((rule) => rule.metadata.id);
  assert.ok(ids.includes("js/require-ts-check"));
  assert.ok(ids.includes("package/allowed-name"));
  assert.ok(ids.includes("test/no-directory-fixture-copy"));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(recommendedRules, before);
});

test("missing preset packages and enabled rules from unloaded presets fail with installation guidance", async (t) => {
  const root = await project(t);
  await assert.rejects(
    loadRules(root, { presets: ["js"] }),
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
