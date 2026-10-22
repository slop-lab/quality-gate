import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { type QualityGateConfig, runQualityGate } from "@slop-lab/qg-core";
import { createFixture, runRule } from "@slop-lab/qg-rule-test-utils";
import {
  repositoryFileRules,
  requiredCompanionsRule,
  requireGitattributesRule,
} from "./required-files.js";

for (const mode of ["changed", "full"] as const) {
  test(`root policies report both missing files in ${mode} mode, regardless of changed paths`, async (t) => {
    const fixture = await createFixture({
      "src/main.ts": "export {};",
      "docs/README.md": "# Nested",
    });
    t.after(() => fixture.cleanup());
    const result = await runQualityGate({
      root: fixture.root,
      mode,
      rules: repositoryFileRules,
      changedProvider: fixture.changedProvider([]),
    });
    assert.deepEqual(
      result.diagnostics.map((item) => [item.ruleId, item.path, item.severity]),
      [
        ["repo/require-readme", "README.md", "error"],
        ["repo/require-gitattributes", ".gitattributes", "error"],
      ],
    );
  });
}

test("root policies accept the exact root filenames and reject directories masquerading as files", async (t) => {
  const fixture = await createFixture({
    "README.md": "",
    ".gitattributes": "# Policy\n* text=auto eol=lf\n",
  });
  t.after(() => fixture.cleanup());
  assert.deepEqual(
    (
      await runQualityGate({
        root: fixture.root,
        mode: "full",
        rules: repositoryFileRules,
      })
    ).diagnostics,
    [],
  );
  const directories = await createFixture({});
  t.after(() => directories.cleanup());
  await mkdir(directories.path("README.md"));
  await mkdir(directories.path(".gitattributes"));
  assert.equal(
    (
      await runQualityGate({
        root: directories.root,
        mode: "full",
        rules: repositoryFileRules,
      })
    ).diagnostics.length,
    2,
  );
});

test("LF baseline allows spacing, attribute ordering, split declarations, and intentional file exceptions", async (t) => {
  const fixture = await createFixture({});
  t.after(() => fixture.cleanup());
  for (const content of [
    "\uFEFF# Header\r\n  *\teol=lf text=auto\r\n",
    "* text=auto\n* eol=lf\n*.png -text\n*.bat eol=crlf\n",
    '"*" text=auto eol=lf\n',
    "** text=auto eol=lf\n",
    "[attr]lf text=auto eol=lf\n* lf\n",
    "* text=auto eol=lf\n* -binary\n",
  ]) {
    await fixture.write(".gitattributes", content);
    assert.deepEqual(
      (await runRule({ fixture, rule: requireGitattributesRule })).diagnostics,
      [],
      content,
    );
  }
});

test("LF baseline rejects empty, commented, partial, and later conflicting universal assignments", async (t) => {
  const fixture = await createFixture({});
  t.after(() => fixture.cleanup());
  for (const content of [
    "",
    "# * text=auto eol=lf\n",
    "*.md text=auto eol=lf\n",
    "* text eol=lf\n",
    "* text=auto eol=crlf\n",
    "* text=auto eol=lf\n* -text\n",
    "* text=auto eol=lf\n* !eol\n",
    "* text=auto eol=lf\n* binary\n",
    "* text=auto eol=lf # inline comments are invalid in Git\n",
    "* text=auto eol=lf\n* nolf\n[attr]nolf -text\n",
  ]) {
    await fixture.write(".gitattributes", content);
    const result = await runRule({ fixture, rule: requireGitattributesRule });
    assert.equal(result.diagnostics.length, 1, content);
    assert.match(result.diagnostics[0]?.message ?? "", /text=auto eol=lf/);
  }
});

test("root requirements respect explicit disabling and path-specific severity", async (t) => {
  const fixture = await createFixture({});
  t.after(() => fixture.cleanup());
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: repositoryFileRules,
    config: {
      rules: { "repo/require-gitattributes": "off" },
      overrides: [
        { files: ["README.md"], rules: { "repo/require-readme": "warning" } },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.severity]),
    [["README.md", "warning"]],
  );
});

test("companion policies are opt-in and trigger from neighboring files without affecting unrelated directories", async (t) => {
  const fixture = await createFixture({
    "packages/app/package.json": "{}",
    "packages/complete/package.json": "{}",
    "packages/complete/README.md": "# Complete",
    "packages/rust/Cargo.toml": "",
    "dist/package.json": "{}",
  });
  t.after(() => fixture.cleanup());
  assert.deepEqual(
    (await runRule({ fixture, rule: requiredCompanionsRule })).diagnostics,
    [],
  );
  const config: QualityGateConfig = {
    rules: {
      "files/required-companions": [
        "error",
        {
          policies: [
            {
              when: { allOf: ["package.json"], noneOf: ["Cargo.toml"] },
              files: ["README.md"],
            },
          ],
        },
      ],
    },
  };
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [requiredCompanionsRule],
    config,
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["packages/app/README.md"],
  );
});

test("changed companion scans include rename origins, deletions, and parent directories", async (t) => {
  const fixture = await createFixture({
    "packages/app/package.json": "{}",
    "packages/untouched/package.json": "{}",
    "packages/old/package.json": "{}",
  });
  t.after(() => fixture.cleanup());
  const result = await runQualityGate({
    root: fixture.root,
    mode: "changed",
    rules: [requiredCompanionsRule],
    changedProvider: fixture.changedProvider([
      { status: "deleted", path: "packages/app/README.md" },
      {
        status: "renamed",
        path: "elsewhere/README.md",
        oldPath: "packages/old/README.md",
      },
    ]),
    config: {
      rules: {
        "files/required-companions": [
          "error",
          {
            policies: [
              { when: { anyOf: ["package.json"] }, files: ["README.md"] },
            ],
          },
        ],
      },
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["packages/app/README.md", "packages/old/README.md"],
  );
});

test("staged root requirements and companion triggers read the index instead of unstaged files", async (t) => {
  const fixture = await createFixture({
    "src/main.ts": "export {};",
    ".gitattributes": "* text=auto eol=crlf\n",
  });
  t.after(() => fixture.cleanup());
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: fixture.root });
  await exec("git", ["add", "."], { cwd: fixture.root });
  await fixture.write("README.md", "# Unstaged");
  await fixture.write(".gitattributes", "* text=auto eol=lf\n");
  const result = await runQualityGate({
    root: fixture.root,
    staged: true,
    rules: repositoryFileRules,
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["README.md", ".gitattributes"],
  );
  await fixture.write("package.json", "{}");
  const config: QualityGateConfig = {
    rules: {
      "files/required-companions": [
        "error",
        {
          policies: [{ when: { anyOf: ["package.json"] }, files: ["LICENSE"] }],
        },
      ],
    },
  };
  assert.deepEqual(
    (
      await runQualityGate({
        root: fixture.root,
        staged: true,
        rules: [requiredCompanionsRule],
        config,
      })
    ).diagnostics,
    [],
  );
  await exec("git", ["add", "package.json"], { cwd: fixture.root });
  assert.equal(
    (
      await runQualityGate({
        root: fixture.root,
        staged: true,
        rules: [requiredCompanionsRule],
        config,
      })
    ).diagnostics[0]?.path,
    "LICENSE",
  );
});

test("companion requirements cannot target files outside their directory", async (t) => {
  const fixture = await createFixture({ "package.json": "{}" });
  t.after(() => fixture.cleanup());
  await assert.rejects(
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [requiredCompanionsRule],
      config: {
        rules: {
          "files/required-companions": [
            "error",
            {
              policies: [
                { when: { anyOf: ["package.json"] }, files: ["../README.md"] },
              ],
            },
          ],
        },
      },
    }),
    /literal filenames/,
  );
});

test("directory policies inherit through overrides and per-file severity still applies", async (t) => {
  const fixture = await createFixture({
    "packages/app/src/file.ts": "export {};",
    "packages/app/package.json": "{}",
    "packages/off/package.json": "{}",
  });
  t.after(() => fixture.cleanup());
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [requiredCompanionsRule],
    config: {
      overrides: [
        {
          files: ["packages/**"],
          rules: {
            "files/required-companions": [
              "error",
              {
                directories: ["packages/*"],
                policies: [
                  { when: { anyOf: ["package.json"] }, files: ["README.md"] },
                ],
              },
            ],
          },
        },
        {
          files: ["packages/app/README.md"],
          rules: { "files/required-companions": "warning" },
        },
        {
          files: ["packages/off/**"],
          rules: { "files/required-companions": "off" },
        },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.severity]),
    [["packages/app/README.md", "warning"]],
  );
});
