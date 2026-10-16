import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";
import { runQualityGate } from "@slop-lab/qg-core";
import { createFixture, runRule } from "@slop-lab/qg-test-utils";
import { maxFilesPerDirectoryRule as rule } from "./directory-limits.js";

function files(directory: string, count: number): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `${directory}/file-${index}.txt`,
      "x",
    ]),
  );
}

test("directory counts warn above 50, error above 100, and never aggregate descendants", async (t) => {
  const fixture = await createFixture({
    ...files("fifty", 50),
    ...files("warning", 51),
    ...files("hundred", 100),
    ...files("error", 101),
    ...files("parent/child", 101),
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule });
  assert.deepEqual(
    result.diagnostics.map((item) => [
      item.path,
      item.severity,
      item.metadata?.fileCount,
    ]),
    [
      ["error", "error", 101],
      ["hundred", "warning", 100],
      ["parent/child", "error", 101],
      ["warning", "warning", 51],
    ],
  );
  assert(result.diagnostics.every((item) => item.pathKind === "directory"));
});

test("changed scans inspect all current files in affected parents and include deletion/rename origins", async (t) => {
  const fixture = await createFixture({
    ...files("added", 51),
    ...files("old", 51),
    ...files("deleted", 51),
    ...files("untouched", 101),
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule,
    mode: "changed",
    changes: [
      { status: "added", path: "added/file-50.txt" },
      { status: "modified", path: "added/file-50.txt" },
      { status: "renamed", path: "new/file.txt", oldPath: "old/moved.txt" },
      { status: "deleted", path: "deleted/gone.txt" },
      { status: "deleted", path: "removed/gone.txt" },
    ],
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.metadata?.fileCount]),
    [
      ["added", 51],
      ["deleted", 51],
      ["old", 51],
    ],
  );
});

test("generated files, ignored paths, and generated directories share the common artifact policy", async (t) => {
  const fixture = await createFixture({
    ...files("source", 49),
    "source/package-lock.json": "{}",
    "source/generated.ts": "",
    "source/skip.txt": "",
    ...files("node_modules/pkg", 101),
    ...files(".local/cache", 101),
  });
  t.after(() => fixture.cleanup());
  const config = {
    artifacts: { generated: { include: ["source/generated.ts"] } },
    rules: {
      [rule.metadata.id]: ["error", { ignoredPaths: ["source/skip.txt"] }] as [
        "error",
        { ignoredPaths: string[] },
      ],
    },
  };
  assert.deepEqual(
    (
      await runQualityGate({
        root: fixture.root,
        mode: "full",
        rules: [rule],
        config,
      })
    ).diagnostics,
    [],
  );
  const included = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [rule],
    config: {
      ...config,
      overrides: [
        {
          directory: "source",
          scope: "self",
          rules: { [rule.metadata.id]: ["error", { includeGenerated: true }] },
        },
      ],
    },
  });
  assert.deepEqual(
    included.diagnostics.map((item) => [item.path, item.metadata?.fileCount]),
    [["source", 51]],
  );
});

test("self-only overrides enable exactly one directory and retain inherited defaults elsewhere", async (t) => {
  const fixture = await createFixture({
    ...files("src", 51),
    ...files("src/child", 101),
    ...files("sibling", 101),
  });
  t.after(() => fixture.cleanup());
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [rule],
    config: {
      rules: { [rule.metadata.id]: "off" },
      overrides: [
        {
          directory: "src",
          scope: "self",
          rules: { [rule.metadata.id]: "error" },
        },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.severity]),
    [["src", "warning"]],
  );
  const limits = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [rule],
    config: {
      overrides: [
        {
          directory: "src",
          scope: "self",
          rules: {
            [rule.metadata.id]: ["error", { limit: 200, warningLimit: 200 }],
          },
        },
      ],
    },
  });
  assert.deepEqual(
    limits.diagnostics.map((item) => item.path),
    ["sibling", "src/child"],
  );
});

test("a self-only ignore does not suppress checks in descendant directories", async (t) => {
  const fixture = await createFixture({
    ...files("src", 101),
    ...files("src/child", 101),
  });
  t.after(() => fixture.cleanup());
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [rule],
    config: {
      overrides: [
        {
          directory: "src",
          scope: "self",
          rules: { [rule.metadata.id]: ["error", { ignoredPaths: ["src"] }] },
        },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["src/child"],
  );
});

test("root directory settings and severity caps apply to directory diagnostics", async (t) => {
  const fixture = await createFixture(
    Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`file-${index}.txt`, "x"]),
    ),
  );
  t.after(() => fixture.cleanup());
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [rule],
    config: {
      overrides: [
        {
          directory: ".",
          scope: "self",
          rules: { [rule.metadata.id]: "warning" },
        },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.severity]),
    [[".", "warning"]],
  );
});

test("staged directory counts use index entries rather than unstaged deletions or additions", async (t) => {
  const fixture = await createFixture(files("src", 101));
  t.after(() => fixture.cleanup());
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: fixture.root });
  await exec("git", ["add", "."], { cwd: fixture.root });
  await rm(fixture.path("src/file-100.txt"));
  assert.equal(
    (await runQualityGate({ root: fixture.root, staged: true, rules: [rule] }))
      .diagnostics[0]?.metadata?.fileCount,
    101,
  );
  await exec("git", ["add", "-u"], { cwd: fixture.root });
  await fixture.write("src/unstaged.txt", "x");
  const result = await runQualityGate({
    root: fixture.root,
    staged: true,
    rules: [rule],
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.metadata?.fileCount, item.severity]),
    [[100, "warning"]],
  );
});

test("invalid directory thresholds fail clearly", async (t) => {
  const fixture = await createFixture({ "file.txt": "x" });
  t.after(() => fixture.cleanup());
  await assert.rejects(
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [rule],
      config: { rules: { [rule.metadata.id]: ["error", { limit: -1 }] } },
    }),
    /non-negative integer/,
  );
});
