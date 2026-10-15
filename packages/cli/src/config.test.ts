import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { type Rule, resolveRuleConfig } from "@quality-gate/core";
import { loadConfig } from "./config.js";

const rule: Rule<{ limit: number }> = {
  metadata: {
    id: "test/limit",
    name: "limit",
    description: "limit",
    defaultSeverity: "error",
    supports: ["full"],
    scope: "file",
    requires: [],
    fixable: "none",
    defaultOptions: { limit: 1000 },
  },
  async check() {
    return [];
  },
};

test("nested .qualitygate.yaml files inherit and override by directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quality-gate-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, ".qualitygate.yaml", config(100));
  await write(root, "packages/.qualitygate.yaml", config(50));
  await write(
    root,
    "packages/app/.qualitygate.yaml",
    `rules:\n  test/limit: off\noverrides:\n  - files: ["generated/**"]\n    rules:\n      test/limit:\n        severity: warning\n        options: { limit: 10 }\n`,
  );

  const loaded = await loadConfig(root);
  assert.equal(resolveRuleConfig(loaded, rule, "README.md").options.limit, 100);
  assert.equal(
    resolveRuleConfig(loaded, rule, "packages/lib/a.ts").options.limit,
    50,
  );
  assert.equal(
    resolveRuleConfig(loaded, rule, "packages/app/a.ts").enabled,
    false,
  );
  const generated = resolveRuleConfig(
    loaded,
    rule,
    "packages/app/generated/a.ts",
  );
  assert.equal(generated.enabled, true);
  assert.equal(generated.severity, "warning");
  assert.equal(generated.options.limit, 10);
});

test("legacy root filename remains supported", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quality-gate-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, "qualitygate.config.yaml", config(42));
  const loaded = await loadConfig(root);
  assert.equal(resolveRuleConfig(loaded, rule, "a.ts").options.limit, 42);
});

function config(limit: number): string {
  return `rules:\n  test/limit:\n    severity: error\n    options: { limit: ${limit} }\n`;
}

async function write(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const fullPath = join(root, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}
