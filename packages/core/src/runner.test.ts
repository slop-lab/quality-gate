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
  async readFileBytes() {
    return new Uint8Array();
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

test("configured messages apply per path and to repository diagnostics while preserving diagnostic details", async () => {
  const rule: Rule = {
    metadata: {
      id: "test/messages",
      name: "messages",
      description: "messages",
      defaultSeverity: "error",
      supports: ["full"],
      scope: "file",
      requires: [],
      fixable: "suggestion",
    },
    async check() {
      return [
        undefined,
        "root.ts",
        "custom/file.ts",
        "inherited/file.ts",
        "disabled/file.ts",
      ].map((path) => ({
        ruleId: "test/messages",
        severity: "error" as const,
        message: "Original details",
        path,
        scope: "file" as const,
        suggestedFix: { message: "Original fix" },
        metadata: { detail: 42 },
      }));
    },
  };
  const result = await runQualityGate({
    root: ".",
    mode: "full",
    rules: [rule],
    fs: emptyFs,
    config: {
      rules: {
        "test/messages": {
          severity: "error",
          message: "Root recovery instructions",
        },
      },
      overrides: [
        {
          files: ["custom/**"],
          rules: {
            "test/messages": {
              severity: "warning",
              message: "Custom recovery instructions",
            },
          },
        },
        { files: ["inherited/**"], rules: { "test/messages": ["info", {}] } },
        { files: ["disabled/**"], rules: { "test/messages": "off" } },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map(({ path, message, severity }) => ({
      path,
      message,
      severity,
    })),
    [
      {
        path: undefined,
        message: "Root recovery instructions",
        severity: "error",
      },
      {
        path: "root.ts",
        message: "Root recovery instructions",
        severity: "error",
      },
      {
        path: "custom/file.ts",
        message: "Custom recovery instructions",
        severity: "warning",
      },
      {
        path: "inherited/file.ts",
        message: "Root recovery instructions",
        severity: "info",
      },
    ],
  );
  for (const diagnostic of result.diagnostics) {
    assert.deepEqual(diagnostic.suggestedFix, { message: "Original fix" });
    assert.deepEqual(diagnostic.metadata, { detail: 42 });
  }
  const unconfigured = await runQualityGate({
    root: ".",
    mode: "full",
    rules: [rule],
    fs: emptyFs,
  });
  assert.ok(
    unconfigured.diagnostics.every(
      ({ message }) => message === "Original details",
    ),
  );
});

test("object overrides enable a default-disabled rule and apply its message", async () => {
  const rule: Rule = {
    metadata: {
      id: "test/opt-in",
      name: "opt-in",
      description: "opt-in",
      defaultSeverity: "error",
      defaultEnabled: false,
      supports: ["full"],
      scope: "file",
      requires: [],
      fixable: "none",
    },
    async check() {
      return ["enabled/a.ts", "disabled/a.ts"].map((path) => ({
        ruleId: "test/opt-in",
        severity: "error" as const,
        message: "Original",
        scope: "file" as const,
        path,
      }));
    },
  };
  const result = await runQualityGate({
    root: ".",
    mode: "full",
    rules: [rule],
    fs: emptyFs,
    config: {
      overrides: [
        {
          files: ["enabled/**"],
          rules: { "test/opt-in": { message: "Recovery" } },
        },
      ],
    },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.message, "Recovery");
  assert.equal(result.diagnostics[0]?.path, "enabled/a.ts");
});
