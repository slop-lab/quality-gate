import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type ProcessExecOptions,
  type ProcessProvider,
  type ProcessResult,
  runQualityGate,
} from "@slop-lab/qg-core";
import { createFixture } from "@slop-lab/qg-rule-testing";
import { eslintRule } from "./index.js";

function mockTool(
  result: ProcessResult = { exitCode: 1, stdout: "", stderr: "format differs" },
) {
  const calls: ProcessExecOptions[] = [];
  let version = "1.0.0";
  const provider: ProcessProvider = {
    async exec(options) {
      calls.push(options);
      return options.args.includes("--version")
        ? { exitCode: 0, stdout: version, stderr: "" }
        : result;
    },
  };
  return {
    provider,
    calls,
    setVersion(value: string) {
      version = value;
    },
    checks() {
      return calls.filter((call) => call.input !== undefined);
    },
  };
}

test("external adapters never discover or execute tools unless enabled", async (t) => {
  const fixture = await createFixture({ "a.js": "const x=1;" });
  t.after(() => fixture.cleanup());
  const tool = mockTool();
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [eslintRule],
    process: tool.provider,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(tool.calls.length, 0);
});

test("ESLint JSON locations, tool rule IDs, warnings, and severity caps survive adaptation", async (t) => {
  const fixture = await createFixture({ "a.js": "debugger;\n" });
  t.after(() => fixture.cleanup());
  const tool = mockTool({
    exitCode: 1,
    stderr: "",
    stdout: JSON.stringify([
      {
        messages: [
          {
            severity: 2,
            ruleId: "no-debugger",
            message: "Unexpected debugger.",
            line: 1,
            column: 1,
            endLine: 1,
            endColumn: 10,
          },
          {
            severity: 1,
            ruleId: "example",
            message: "Warning.",
            line: 1,
            column: 1,
          },
        ],
      },
    ]),
  });
  const run = (severity: "error" | "warning") =>
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [eslintRule],
      process: tool.provider,
      config: { rules: { "external/eslint": severity } },
    });
  const result = await run("error");
  assert.deepEqual(
    result.diagnostics.map((item) => item.severity),
    ["error", "warning"],
  );
  assert.equal(result.diagnostics[0]?.endColumn, 10);
  assert.equal(result.diagnostics[0]?.metadata?.toolRuleId, "no-debugger");
  assert.deepEqual(
    (await run("warning")).diagnostics.map((item) => item.severity),
    ["warning", "warning"],
  );
  assert(tool.checks()[0]?.args.includes("--stdin"));
});

test("ESLint nonzero warning thresholds become QG errors even without native errors", async (t) => {
  const fixture = await createFixture({ "a.js": "bad" });
  t.after(() => fixture.cleanup());
  const tool = mockTool({
    exitCode: 1,
    stdout: JSON.stringify([
      { messages: [{ severity: 1, message: "Warning." }] },
    ]),
    stderr: "Too many warnings",
  });
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [eslintRule],
    process: tool.provider,
    config: {
      rules: { "external/eslint": ["error", { args: ["--max-warnings=0"] }] },
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.severity),
    ["warning", "error"],
  );
});

test("malformed ESLint reports fail instead of silently passing", async (t) => {
  const fixture = await createFixture({ "a.js": "bad" });
  t.after(() => fixture.cleanup());
  await assert.rejects(
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [eslintRule],
      process: mockTool({ exitCode: 0, stdout: "not json", stderr: "" })
        .provider,
      config: { rules: { "external/eslint": "error" } },
    }),
  );
});
