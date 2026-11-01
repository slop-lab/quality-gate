import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGlobRecheckTrigger,
  type RecheckTriggerPlugin,
  shouldRecheckAllFiles,
} from "./changes.js";

test("full scans always inspect existing files", async () => {
  assert.equal(
    await shouldRecheckAllFiles({ mode: "full", changes: [] }, []),
    true,
  );
});

test("changed scans recheck existing files for matching current or old paths", async () => {
  const patterns = [".gitignore", "config/**/*.yaml"];
  assert.equal(
    await shouldRecheckAllFiles(
      {
        mode: "changed",
        changes: [{ status: "modified", path: "config/rules/table.yaml" }],
      },
      [createGlobRecheckTrigger(patterns)],
    ),
    true,
  );
  assert.equal(
    await shouldRecheckAllFiles(
      {
        mode: "changed",
        changes: [
          {
            status: "renamed",
            path: "ignore.txt",
            oldPath: ".gitignore",
          },
        ],
      },
      [createGlobRecheckTrigger(patterns)],
    ),
    true,
  );
});

test("changed scans stay incremental when no trigger pattern matches", async () => {
  assert.equal(
    await shouldRecheckAllFiles(
      {
        mode: "changed",
        changes: [{ status: "modified", path: "src/index.ts" }],
      },
      [createGlobRecheckTrigger([".gitignore", "config/**/*.yaml"])],
    ),
    false,
  );
});

test("changed scans accept asynchronous custom trigger plugins", async () => {
  const trigger: RecheckTriggerPlugin = {
    id: "project/lockfile-trigger",
    version: "1",
    async shouldRecheck(input) {
      return input.changes.some(
        (change) =>
          change.status === "added" && change.path.endsWith(".lock.json"),
      );
    },
  };
  assert.equal(
    await shouldRecheckAllFiles(
      {
        mode: "changed",
        changes: [{ status: "added", path: "config/tools.lock.json" }],
      },
      [trigger],
    ),
    true,
  );
});
