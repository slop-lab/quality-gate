import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDiffArgs, parseNameStatus } from "./git.js";

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
    "--find-renames",
  ]);
  assert.deepEqual(buildDiffArgs({ root: ".", workingTree: true }), [
    "diff",
    "--name-status",
    "--find-renames",
  ]);
  assert.deepEqual(
    buildDiffArgs({ root: ".", base: "origin/main", head: "HEAD" }),
    ["diff", "--name-status", "--find-renames", "origin/main...HEAD"],
  );
});
