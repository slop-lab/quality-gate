import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  buildDiffArgs,
  GitChangedProvider,
  GitIndexFileSystemProvider,
  parseNameStatus,
} from "./git.js";

const execFileAsync = promisify(execFile);

test("parseNameStatus parses regular entries", () => {
  assert.deepEqual(
    parseNameStatus("A\tsrc/new.ts\nM\tsrc/changed.ts\nD\tsrc/deleted.ts\n"),
    [
      { status: "added", path: "src/new.ts" },
      { status: "modified", path: "src/changed.ts" },
      { status: "deleted", path: "src/deleted.ts" },
    ],
  );
});

test("parseNameStatus parses rename similarity and endpoints", () => {
  assert.deepEqual(parseNameStatus("R91\tsrc/old.ts\tsrc/new.ts\n"), [
    {
      status: "renamed",
      path: "src/new.ts",
      oldPath: "src/old.ts",
      similarity: 91,
    },
  ]);
});

test("buildDiffArgs supports staged, working tree, and ref scans", () => {
  assert.deepEqual(buildDiffArgs({ root: ".", staged: true }), [
    "diff",
    "--cached",
    "--name-status",
    "-z",
    "--find-renames",
  ]);
  assert.deepEqual(buildDiffArgs({ root: ".", workingTree: true }), [
    "diff",
    "--name-status",
    "-z",
    "--find-renames",
  ]);
  assert.deepEqual(
    buildDiffArgs({ root: ".", base: "origin/main", head: "HEAD" }),
    ["diff", "--name-status", "-z", "--find-renames", "origin/main...HEAD"],
  );
});

test("GitIndexFileSystemProvider reads staged content instead of working tree content", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-git-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await writeFile(join(root, "doc.md"), "staged/value\n");
  await execFileAsync("git", ["add", "doc.md"], { cwd: root });
  await writeFile(join(root, "doc.md"), "unstaged/value\n");

  const fs = new GitIndexFileSystemProvider(root);
  assert.equal(await fs.readFile("doc.md"), "staged/value\n");
  assert.equal(await fs.isFile("doc.md"), true);
  assert.deepEqual(await fs.readDirectory("."), [
    { name: "doc.md", path: "doc.md", type: "file" },
  ]);
});

test("NUL status records preserve tabs, Unicode, newlines and rename endpoints", () => {
  assert.deepEqual(
    parseNameStatus("A\0한글.ts\0R100\0old\tname.ts\0new\nname.ts\0"),
    [
      { status: "added", path: "한글.ts" },
      {
        status: "renamed",
        oldPath: "old\tname.ts",
        path: "new\nname.ts",
        similarity: 100,
      },
    ],
  );
});

test("real staged paths are decoded without Git quoting and index directory existence works", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-index-paths-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs", "한글.md"), "text");
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  assert.equal(
    (await new GitChangedProvider().getChanged({ root, staged: true }))[0]
      ?.path,
    "docs/한글.md",
  );
  const fs = new GitIndexFileSystemProvider(root);
  assert.equal(await fs.exists("docs"), true);
  assert.equal(await fs.exists("missing"), false);
});
