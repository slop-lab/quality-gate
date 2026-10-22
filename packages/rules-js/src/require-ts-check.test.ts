import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { runQualityGate } from "@slop-lab/qg-core";
import { createFixture, runRule } from "@slop-lab/qg-rule-testing";
import { requireTsCheckRule } from "./require-ts-check.js";

test("accepts effective TypeScript header directives after whitespace, licenses, and shebangs", async (t) => {
  const fixture = await createFixture({
    "plain.js": "// @ts-check\nconst value = 1;\n",
    "module.mjs":
      "#!/usr/bin/env node\n// @ts-check\nexport const value = 1;\n",
    "common.cjs":
      "\uFEFF\r\n/* License */\r\n// header\r\n\t// @ts-check: enable checking\r\nmodule.exports = 1;",
    "component.jsx": "/// @ts-check\nexport const view = <div />;\n",
    "uppercase.js": "// @TS-CHECK\nconst value = 1;\n",
    "last-wins.js": "// @ts-nocheck\n// @ts-check\nconst value = 1;\n",
    "no-space.js": "//@ts-check",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule: requireTsCheckRule });
  assert.deepEqual(result.diagnostics, []);
});

test("rejects missing, ineffective, string, block, and body-comment annotations", async (t) => {
  const files = {
    "empty.js": "",
    "missing.mjs": "export const value = 1;\n",
    "disabled.js": "// @ts-check\n// @ts-nocheck\nconst value = 1;\n",
    "string.cjs": 'const example = "// @ts-check";\n',
    "template.js": "const example = `\n// @ts-check\n`;\n",
    "body.jsx": "export const view = <div />;\n// @ts-check\n",
    "block.js": "/* @ts-check */\nconst value = 1;\n",
    "example.js": "// Example: // @ts-check\nconst value = 1;\n",
    "typo.js": "// @ts-checking\nconst value = 1;\n",
    "unterminated.js": "/* license\n// @ts-check\n",
    "bom-shebang.js":
      "\uFEFF#!/usr/bin/env node\n// @ts-check\nconst value = 1;\n",
    "indented-shebang.js":
      " #!/usr/bin/env node\n// @ts-check\nconst value = 1;\n",
  };
  const fixture = await createFixture(files);
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule: requireTsCheckRule });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    Object.keys(files).sort(),
  );
  assert(
    result.diagnostics.every(
      (item) =>
        item.ruleId === "js/require-ts-check" &&
        item.severity === "error" &&
        item.line === 1 &&
        item.column === 1,
    ),
  );
});

test("full scans respect default extensions and generated directory exclusions", async (t) => {
  const fixture = await createFixture({
    "src/app.js": "const value = 1;",
    "src/typed.ts": "export const value = 1;",
    "src/view.tsx": "export const view = <div />;",
    "README.md": "// @ts-check",
    "dist/index.js": "const value = 1;",
    "node_modules/pkg/index.js": "const value = 1;",
    ".local/cache/cache.js": "const value = 1;",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule: requireTsCheckRule });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["src/app.js"],
  );
});

test("changed scans inspect current paths once and skip deleted, missing, and ignored files", async (t) => {
  const fixture = await createFixture({
    "src/renamed.js": "const value = 1;",
    "src/unchanged.js": "const value = 1;",
    "src/removed.js": "const value = 1;",
    "dist/generated.js": "const value = 1;",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: requireTsCheckRule,
    mode: "changed",
    changes: [
      { status: "renamed", path: "src/renamed.js", oldPath: "src/old.js" },
      { status: "modified", path: "src/renamed.js" },
      { status: "deleted", path: "src/removed.js" },
      { status: "deleted", path: "src/gone.js" },
      { status: "added", path: "src/missing.js" },
      { status: "modified", path: "dist/generated.js" },
    ],
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["src/renamed.js"],
  );
});

test("project options and path overrides control severity, extensions, and exclusions", async (t) => {
  const fixture = await createFixture({
    "src/app.js": "const value = 1;",
    "src/view.jsx": "const value = 1;",
    "src/off.js": "const value = 1;",
    "vendor/tool.js": "const value = 1;",
    "generated/output.js": "const value = 1;",
  });
  t.after(() => fixture.cleanup());
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    fs: fixture.fs,
    rules: [requireTsCheckRule],
    config: {
      rules: {
        "js/require-ts-check": [
          "error",
          {
            extensions: [".js"],
            ignoredPaths: ["vendor/**"],
            ignoredDirectories: ["generated"],
          },
        ],
      },
      overrides: [
        { files: ["src/app.js"], rules: { "js/require-ts-check": "warning" } },
        { files: ["src/off.js"], rules: { "js/require-ts-check": "off" } },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.severity]),
    [["src/app.js", "warning"]],
  );
});

test("staged checks require the directive in index contents, not just the working tree", async (t) => {
  const fixture = await createFixture({ "script.js": "const value = 1;\n" });
  t.after(() => fixture.cleanup());
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: fixture.root });
  await exec("git", ["add", "script.js"], { cwd: fixture.root });
  await fixture.write("script.js", "// @ts-check\nconst value = 1;\n");
  const options = {
    root: fixture.root,
    mode: "changed" as const,
    staged: true,
    rules: [requireTsCheckRule],
  };
  assert.equal((await runQualityGate(options)).diagnostics.length, 1);
  await exec("git", ["add", "script.js"], { cwd: fixture.root });
  await fixture.write("script.js", "// @ts-nocheck\nconst value = 1;\n");
  assert.deepEqual((await runQualityGate(options)).diagnostics, []);
});
