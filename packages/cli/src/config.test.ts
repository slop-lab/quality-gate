import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { type Rule, resolveRuleConfig } from "@slop-lab/qg-core";
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

test("nested .qg.yaml files inherit and override by directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, ".qg.yaml", config(100));
  await write(root, "packages/.qg.yaml", config(50));
  await write(
    root,
    "packages/app/.qg.yaml",
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

test("alternate root config filename is supported", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, "qg.config.yaml", config(42));
  const loaded = await loadConfig(root);
  assert.equal(resolveRuleConfig(loaded, rule, "a.ts").options.limit, 42);
});

test("root artifact settings are loaded and nested declarations fail clearly", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    ".qg.yaml",
    "artifacts:\n  generated:\n    defaults: false\n    include: ['api/**']\n    exclude: ['api/manual.ts']\n",
  );
  assert.deepEqual((await loadConfig(root))?.artifacts, {
    generated: {
      defaults: false,
      include: ["api/**"],
      exclude: ["api/manual.ts"],
    },
  });
  await write(
    root,
    "packages/.qg.yaml",
    "artifacts:\n  generated:\n    include: ['generated/**']\n",
  );
  await assert.rejects(
    loadConfig(root),
    /artifacts is only allowed in the root config/,
  );
});

test("nested self overrides bind to their own directory and keep file filters relative to explicit directories", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, ".qg.yaml", config(100));
  await write(
    root,
    "packages/app/.qg.yaml",
    "overrides:\n  - scope: self\n    rules:\n      test/limit: [warning, {limit: 10}]\n  - directory: src\n    scope: self\n    files: ['*.ts']\n    excludedFiles: ['skip.ts']\n    rules:\n      test/limit: [error, {limit: 5}]\n",
  );
  const loaded = await loadConfig(root);
  assert.equal(
    resolveRuleConfig(loaded, rule, "packages/app/file.ts").options.limit,
    10,
  );
  assert.equal(
    resolveRuleConfig(loaded, rule, "packages/app", undefined, "directory")
      .options.limit,
    10,
  );
  assert.equal(
    resolveRuleConfig(loaded, rule, "packages/app/src/file.ts").options.limit,
    5,
  );
  assert.equal(
    resolveRuleConfig(loaded, rule, "packages/app/src/skip.ts").options.limit,
    100,
  );
  assert.equal(
    resolveRuleConfig(loaded, rule, "packages/app/src/child/file.ts").options
      .limit,
    100,
  );
  assert.equal(
    resolveRuleConfig(loaded, rule, "packages/sibling/file.ts").options.limit,
    100,
  );
});

test("override scope and directory selectors reject invalid values", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const selector of [
    "directory: ../outside",
    "directory: C:/outside",
    "scope: invalid",
  ]) {
    await write(
      root,
      ".qg.yaml",
      `overrides:\n  - ${selector}\n    rules: {test/limit: error}\n`,
    );
    await assert.rejects(loadConfig(root), /project-relative|self or subtree/);
  }
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

test("messages load from root and nested YAML and inherit through shorthand overrides", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    ".qg.yaml",
    `rules:
  test/limit:
    severity: warning
    message: "Root recovery instructions"
    options: { limit: 100 }
`,
  );
  await write(
    root,
    "packages/.qg.yaml",
    `rules:
  test/limit:
    message: "패키지 복구 안내"
    options: { limit: 50 }
overrides:
  - files: ["app/**"]
    rules:
      test/limit: [info, { limit: 10 }]
`,
  );
  const loaded = await loadConfig(root);
  assert.equal(
    resolveRuleConfig(loaded, rule, "root.ts").message,
    "Root recovery instructions",
  );
  const nested = resolveRuleConfig(loaded, rule, "packages/app/a.ts");
  assert.equal(nested.message, "패키지 복구 안내");
  assert.equal(nested.options.limit, 10);
  assert.equal(nested.severity, "info");
});

test("non-string diagnostic messages fail with a configuration error", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const value of ["42", "false", "null", "[]", "{}"]) {
    await write(
      root,
      ".qg.yaml",
      `rules:\n  test/limit:\n    message: ${value}\n`,
    );
    await assert.rejects(
      loadConfig(root),
      /rules.test\/limit.message must be a string/,
    );
  }
});

test("pre-commit command checks load from root config and reject invalid declarations", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const check = {
    name: "test",
    command: "pnpm",
    args: ["test"],
    timeoutMs: 1000,
    message: "Fix tests",
  };
  await write(
    root,
    ".qg.yaml",
    JSON.stringify({ hooks: { preCommit: { checks: [check] } } }),
  );
  assert.deepEqual((await loadConfig(root))?.hooks?.preCommit?.checks, [check]);
  for (const invalid of [
    {},
    { ...check, command: "" },
    { ...check, args: "test" },
    { ...check, timeoutMs: -1 },
    { ...check, message: 42 },
  ]) {
    await write(
      root,
      ".qg.yaml",
      JSON.stringify({ hooks: { preCommit: { checks: [invalid] } } }),
    );
    await assert.rejects(loadConfig(root), /hooks.preCommit.checks\[0\]/);
  }
  await write(root, ".qg.yaml", "{}");
  await write(root, "nested/.qg.yaml", "hooks: { preCommit: { checks: [] } }");
  await assert.rejects(
    loadConfig(root),
    /hooks is only allowed in the root config/,
  );
});

test("hook installation policy is a single validated setting", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const installation of ["check", "auto", "off"]) {
    await write(
      root,
      ".qg.yaml",
      JSON.stringify({ hooks: { preCommit: { installation } } }),
    );
    assert.equal(
      (await loadConfig(root))?.hooks?.preCommit?.installation,
      installation,
    );
  }
  for (const installation of [true, false, null, "invalid", {}]) {
    await write(
      root,
      ".qg.yaml",
      JSON.stringify({ hooks: { preCommit: { installation } } }),
    );
    await assert.rejects(
      loadConfig(root),
      /hooks.preCommit.installation must be check, auto, or off/,
    );
  }
});

test("optional presets are explicitly selected in root configuration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, ".qg.yaml", "presets: [js-directives, js-test-fixtures]\n");
  assert.deepEqual((await loadConfig(root))?.presets, [
    "js-directives",
    "js-test-fixtures",
  ]);
  for (const presets of ["js-directives", ["unknown"], [42]]) {
    await write(root, ".qg.yaml", JSON.stringify({ presets }));
    await assert.rejects(loadConfig(root), /presets/);
  }
  await write(root, ".qg.yaml", "{}");
  await write(root, "nested/.qg.yaml", "presets: [js-directives]\n");
  await assert.rejects(
    loadConfig(root),
    /presets is only allowed in the root config/,
  );
});

test("node-test hook configuration accepts file globs and rejects conflicting or invalid fields", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const check = {
    name: "tests",
    type: "node-test",
    files: ["test/**/*.test.mjs"],
    timeoutMs: 1000,
    message: "Fix tests",
  };
  await write(
    root,
    ".qg.yaml",
    JSON.stringify({ hooks: { preCommit: { checks: [check] } } }),
  );
  assert.deepEqual((await loadConfig(root))?.hooks?.preCommit?.checks, [check]);
  for (const invalid of [
    { ...check, type: "unknown" },
    { ...check, files: undefined },
    { ...check, files: [] },
    { ...check, files: [""] },
    { ...check, files: [42] },
    { ...check, files: "test.js" },
    { ...check, command: "node" },
    { ...check, args: [] },
    { name: "command", command: "node", files: ["test.js"] },
  ]) {
    await write(
      root,
      ".qg.yaml",
      JSON.stringify({ hooks: { preCommit: { checks: [invalid] } } }),
    );
    await assert.rejects(loadConfig(root), /hooks.preCommit.checks\[0\]/);
  }
});

test("shared checks load at the root and reject malformed or nested configuration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checks = [
    { name: "external", type: "command", command: "tool", args: ["check"] },
    { name: "tests", type: "node-test", files: ["test/**/*.test.mjs"] },
  ];
  await write(root, ".qg.yaml", JSON.stringify({ checks }));
  assert.deepEqual((await loadConfig(root))?.checks, checks);
  for (const invalid of [
    null,
    {},
    "tool",
    [{ name: "broken" }],
    [{ ...checks[1], files: [] }],
  ]) {
    await write(root, ".qg.yaml", JSON.stringify({ checks: invalid }));
    await assert.rejects(loadConfig(root), /checks/);
  }
  await write(root, ".qg.yaml", "{}");
  await write(root, "nested/.qg.yaml", JSON.stringify({ checks }));
  await assert.rejects(
    loadConfig(root),
    /checks is only allowed in the root config/,
  );
});

test("custom ruleModules are restricted to non-empty module specifiers in root config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(
    root,
    ".qg.yaml",
    JSON.stringify({ ruleModules: ["./qg-rules.mjs", "custom-rules"] }),
  );
  assert.deepEqual((await loadConfig(root))?.ruleModules, [
    "./qg-rules.mjs",
    "custom-rules",
  ]);
  for (const ruleModules of ["./rules.mjs", [42], [""], [" "]]) {
    await write(root, ".qg.yaml", JSON.stringify({ ruleModules }));
    await assert.rejects(loadConfig(root), /ruleModules/);
  }
  await write(root, ".qg.yaml", "{}");
  await write(root, "nested/.qg.yaml", "ruleModules: []");
  await assert.rejects(
    loadConfig(root),
    /ruleModules is only allowed in the root config/,
  );
});

test("the JS test preset is explicit and the old language-agnostic test label is rejected", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const preset of ["test", "js-test", "unknown"]) {
    await write(root, ".qg.yaml", `presets: [${preset}]`);
    await assert.rejects(
      loadConfig(root),
      /presets may only contain js, js-directives, or js-test-fixtures/,
    );
  }
});
