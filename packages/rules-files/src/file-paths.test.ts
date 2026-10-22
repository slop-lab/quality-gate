import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { createFilePathRule } from "@slop-lab/qg-core";
import { createFixture, runRule } from "@slop-lab/qg-rule-testing";
import { allowedFilenameRule, allowedFilePathRule } from "./file-paths.js";

for (const rule of [allowedFilenameRule, allowedFilePathRule]) {
  test(`${rule.metadata.id} is opt-in and matches entire names or paths`, async (t) => {
    const fixture = await createFixture({
      "src/good-name.ts": "",
      "src/BadName.ts": "",
      "other/good-name.ts": "",
    });
    t.after(() => fixture.cleanup());
    assert.deepEqual((await runRule({ fixture, rule })).diagnostics, []);
    const name = rule === allowedFilenameRule;
    const result = await runRule({
      fixture,
      rule,
      severity: "error",
      options: {
        allowedPatterns: [
          name ? "[a-z]+(-[a-z]+)*\\.ts" : "src/[a-z]+(-[a-z]+)*\\.ts",
        ],
      },
    });
    assert.deepEqual(
      result.diagnostics.map((item) => item.path),
      name ? ["src/BadName.ts"] : ["other/good-name.ts", "src/BadName.ts"],
    );
  });
}

test("file path policies honor selection, ignores, per-file overrides, and custom recovery messages", async (t) => {
  const fixture = await createFixture({
    "src/Bad.ts": "",
    "docs/Bad.md": "",
    "vendor/Bad.ts": "",
    "node_modules/Bad.ts": "",
    "dist/Bad.ts": "",
    "src/skip/Bad.ts": "",
    "src/special/Upper.ts": "",
    "src/generated/Bad.ts": "",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: allowedFilenameRule,
    config: {
      artifacts: { generated: { include: ["src/generated/**"] } },
      rules: {
        "files/allowed-name": {
          severity: "error",
          message: "Use lowercase filenames",
          options: {
            files: ["**/*.ts"],
            ignoredPaths: ["vendor/**"],
            allowedPatterns: ["[a-z]+\\.ts"],
          },
        },
      },
      overrides: [
        { files: ["src/skip/**"], rules: { "files/allowed-name": "off" } },
        {
          files: ["src/special/**"],
          rules: {
            "files/allowed-name": [
              "warning",
              { allowedPatterns: ["Upper\\.ts"] },
            ],
          },
        },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.message]),
    [
      ["src/Bad.ts", "Use lowercase filenames"],
      ["src/generated/Bad.ts", "Use lowercase filenames"],
    ],
  );
});

test("changed path checks inspect destination files once and skip deleted, missing, and unselected paths", async (t) => {
  const fixture = await createFixture({
    "src/Bad.ts": "",
    "src/Other.ts": "",
    "unchanged/Bad.ts": "",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: allowedFilePathRule,
    mode: "changed",
    severity: "error",
    options: {
      allowedPatterns: ["src/[a-z]+\\.ts"],
    },
    changes: [
      { status: "renamed", oldPath: "old/name.ts", path: "src/Bad.ts" },
      { status: "modified", path: "src/Bad.ts" },
      { status: "copied", oldPath: "old/other.ts", path: "src/Other.ts" },
      { status: "deleted", path: "deleted/Bad.ts" },
      { status: "modified", path: "missing/Bad.ts" },
    ],
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["src/Bad.ts", "src/Other.ts"],
  );
});

test("staged naming checks use the index when the worktree has already renamed the file", async (t) => {
  const fixture = await createFixture({ "Bad.ts": "" });
  t.after(() => fixture.cleanup());
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: fixture.root });
  await exec("git", ["add", "."], { cwd: fixture.root });
  const { rename } = await import("node:fs/promises");
  await rename(fixture.path("Bad.ts"), fixture.path("good.ts"));
  const result = await runRule({
    fixture,
    rule: allowedFilenameRule,
    staged: true,
    severity: "error",
    options: {
      allowedPatterns: ["[a-z]+\\.ts"],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["Bad.ts"],
  );
});

test("empty patterns reject selected files and malformed options fail clearly", async (t) => {
  const fixture = await createFixture({ "file.ts": "" });
  t.after(() => fixture.cleanup());
  assert.equal(
    (await runRule({ fixture, rule: allowedFilenameRule, severity: "error" }))
      .diagnostics.length,
    1,
  );
  for (const options of [
    { allowedPatterns: ["["] },
    { allowedPatterns: "file" },
    { files: [42] },
    { ignoredPaths: "vendor/**" },
    { ignoredDirectories: null },
  ]) {
    await assert.rejects(
      runRule({
        fixture,
        rule: allowedFilenameRule,
        severity: "error",
        options: options as never,
      }),
      /invalid allowed pattern|array of strings/,
    );
  }
});

test("custom path rules support asynchronous code, resolved options, and filesystem discovery", async (t) => {
  const rule = createFilePathRule<{ files?: string[]; suffix: string }>({
    id: "project/feature-entry",
    name: "Feature entry",
    description: "Match the parent feature name.",
    defaultOptions: { files: ["features/**/*.ts"], suffix: ".ts" },
    async validate(path, context) {
      const parts = path.split("/");
      const feature = parts.at(-2);
      if (parts.at(-1) === `${feature}${context.options.suffix}`) return;
      if (await context.fs.exists(`features/${feature}/allow-custom`)) return;
      return `Use ${feature}${context.options.suffix}`;
    },
  });
  const fixture = await createFixture({
    "features/cart/cart.ts": "",
    "features/user/wrong.ts": "",
    "features/admin/admin.entry.ts": "",
    "features/custom/other.ts": "",
    "features/custom/allow-custom": "",
    "outside/skip.ts": "",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule,
    severity: "error",
    config: {
      overrides: [
        {
          files: ["features/admin/**"],
          rules: {
            "project/feature-entry": ["error", { suffix: ".entry.ts" }],
          },
        },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.message]),
    [["features/user/wrong.ts", "Use user.ts"]],
  );
});

test("path rules do not skip or partially match filenames containing a newline", async (t) => {
  const fixture = await createFixture({});
  t.after(() => fixture.cleanup());
  fixture.fs.readDirectory = async () => [
    { name: "good.ts\n", path: "good.ts\n", type: "file" },
  ];
  fixture.fs.isFile = async () => true;
  for (const rule of [allowedFilenameRule, allowedFilePathRule]) {
    const result = await runRule({
      fixture,
      rule,
      severity: "error",
      options: { allowedPatterns: ["good\\.ts"] },
    });
    assert.deepEqual(
      result.diagnostics.map((item) => item.path),
      ["good.ts\n"],
    );
  }
});

test("custom path rules recheck selected files when shared dependency inputs change", async (t) => {
  const fixture = await createFixture({
    "package.json": "{}",
    "packages/core/package.json": "{}",
  });
  t.after(() => fixture.cleanup());
  const rule = createFilePathRule({
    id: "project/shared",
    name: "Shared",
    description: "Shared metadata",
    recheckOnChanges: ["package.json"],
    defaultOptions: { files: ["packages/*/package.json"] },
    validate: () => "Changed shared input",
  });
  const result = await runRule({
    fixture,
    rule,
    severity: "error",
    mode: "changed",
    changes: [{ status: "modified", path: "package.json" }],
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["packages/core/package.json"],
  );
});
