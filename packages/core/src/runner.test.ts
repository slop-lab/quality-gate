import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ChangedProvider,
  type FileSystemProvider,
  type Rule,
  runQualityGate,
} from "./index.js";

const emptyFs: FileSystemProvider = {
  async exists() {
    return false;
  },
  async isFile() {
    return false;
  },
  async isDirectory() {
    return false;
  },
  async readDirectory() {
    return [];
  },
  async readFile() {
    return "";
  },
};

test("runQualityGate injects changed provider into changed scans", async () => {
  const changedProvider: ChangedProvider = {
    async getChanged() {
      return [{ status: "modified", path: "src/index.ts" }];
    },
  };

  const rule: Rule = {
    metadata: {
      id: "test/changes",
      name: "changes",
      description: "changes",
      defaultSeverity: "error",
      supports: ["changed"],
      scope: "repo",
      requires: ["gitChanges"],
      fixable: "none",
    },
    async check(context) {
      return [
        {
          ruleId: "test/changes",
          severity: context.severity,
          message: String(context.changes.length),
          scope: "repo",
        },
      ];
    },
  };

  const result = await runQualityGate({
    root: ".",
    mode: "changed",
    rules: [rule],
    changedProvider,
    fs: emptyFs,
  });

  assert.equal(result.changes.length, 1);
  assert.equal(result.diagnostics[0]?.message, "1");
});

test("runQualityGate does not require changed provider for full scans", async () => {
  const rule: Rule = {
    metadata: {
      id: "test/full",
      name: "full",
      description: "full",
      defaultSeverity: "error",
      supports: ["full"],
      scope: "repo",
      requires: [],
      fixable: "none",
    },
    async check(context) {
      return [
        {
          ruleId: "test/full",
          severity: context.severity,
          message: context.mode,
          scope: "repo",
        },
      ];
    },
  };

  const result = await runQualityGate({
    root: ".",
    mode: "full",
    rules: [rule],
    fs: emptyFs,
  });

  assert.equal(result.changes.length, 0);
  assert.equal(result.diagnostics[0]?.message, "full");
});
