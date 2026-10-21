import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  JsonFileRuleCacheStore,
  type ProcessExecOptions,
  type ProcessProvider,
  type ProcessResult,
  type QualityGateConfig,
  type Rule,
  runQualityGate,
} from "@slop-lab/qg-core";
import { createFixture } from "@slop-lab/qg-test-utils";
import {
  biomeRule,
  eslintRule,
  externalToolRules,
  prettierRule,
} from "./external-tools.js";

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
    rules: externalToolRules,
    process: tool.provider,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(tool.calls.length, 0);
});

test("nested opt-in filters changed paths and sends snapshot contents with read-only arguments", async (t) => {
  const fixture = await createFixture({
    "src/a.js": "const x=1;",
    "other.js": "bad",
    "src/deleted.js": "bad",
    "src/dist/out.js": "bad",
  });
  t.after(() => fixture.cleanup());
  const tool = mockTool();
  const result = await runQualityGate({
    root: fixture.root,
    mode: "changed",
    rules: [prettierRule],
    process: tool.provider,
    changedProvider: fixture.changedProvider([
      { status: "renamed", path: "src/a.js", oldPath: "old.js" },
      { status: "modified", path: "src/a.js" },
      { status: "modified", path: "other.js" },
      { status: "deleted", path: "src/deleted.js" },
      { status: "added", path: "src/missing.js" },
      { status: "modified", path: "src/dist/out.js" },
    ]),
    config: {
      overrides: [
        {
          files: ["src/**"],
          rules: {
            "external/prettier": [
              "warning",
              { cache: false, args: ["--single-quote"] },
            ],
          },
        },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.severity]),
    [["src/a.js", "warning"]],
  );
  assert.equal(tool.checks().length, 1);
  assert.equal(tool.checks()[0]?.input, "const x=1;");
  assert.deepEqual(tool.checks()[0]?.args, [
    "--single-quote",
    "--check",
    "--stdin-filepath",
    fixture.path("src/a.js"),
  ]);
  assert.equal(await fixture.read("src/a.js"), "const x=1;");
});

test("staged external checks send index contents even when working tree is formatted", async (t) => {
  const fixture = await createFixture({ "a.js": "const x=1;\n" });
  t.after(() => fixture.cleanup());
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: fixture.root });
  await exec("git", ["add", "a.js"], { cwd: fixture.root });
  await fixture.write("a.js", "const x = 1;\n");
  const tool = mockTool();
  await runQualityGate({
    root: fixture.root,
    staged: true,
    rules: [prettierRule],
    process: tool.provider,
    config: { rules: { "external/prettier": "error" } },
  });
  assert.equal(tool.checks()[0]?.input, "const x=1;\n");
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

test("Biome format compares stdout and places configured flags after its subcommand", async (t) => {
  const fixture = await createFixture({ "a.js": "const x=1;\n" });
  t.after(() => fixture.cleanup());
  const tool = mockTool({ exitCode: 0, stdout: "const x = 1;\n", stderr: "" });
  const config: QualityGateConfig = {
    rules: {
      "external/biome": [
        "error",
        {
          mode: "format",
          useServer: true,
          args: ["--indent-width=4"],
          cache: false,
        },
      ],
    },
  };
  const run = () =>
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [biomeRule],
      process: tool.provider,
      config,
    });
  assert.equal((await run()).diagnostics.length, 1);
  assert.deepEqual(tool.checks()[0]?.args, [
    "format",
    "--indent-width=4",
    `--stdin-file-path=${fixture.path("a.js")}`,
    "--use-server",
  ]);
  await fixture.write("a.js", "const x = 1;\n");
  assert.deepEqual((await run()).diagnostics, []);
});

test("cache persists across runs and invalidates on source, config, dependency, version, and option changes", async (t) => {
  const fixture = await createFixture({
    "a.js": "bad",
    "dependency.ts": "export {};",
    "tool.json": "{}",
    ".local/extra.cfg": "one",
  });
  t.after(() => fixture.cleanup());
  const tool = mockTool();
  let options = {
    files: ["a.js"],
    cacheInputs: [".local/extra.cfg"],
    args: [] as string[],
  };
  const run = () =>
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [prettierRule],
      process: tool.provider,
      cacheStore: new JsonFileRuleCacheStore(
        fixture.path(".local/cache/rules"),
      ),
      config: { rules: { "external/prettier": ["error", options] } },
    });
  const first = await run();
  assert.deepEqual(await run(), first);
  assert.equal(tool.checks().length, 1);
  for (const path of [
    "a.js",
    "tool.json",
    "dependency.ts",
    ".local/extra.cfg",
  ]) {
    await fixture.write(path, "changed");
    await run();
  }
  assert.equal(tool.checks().length, 5);
  tool.setVersion("2.0.0");
  await run();
  options = { ...options, args: ["--single-quote"] };
  await run();
  assert.equal(tool.checks().length, 7);
  await new JsonFileRuleCacheStore(
    fixture.path(".local/cache/rules"),
  ).clearRule("external/prettier");
  await run();
  assert.equal(tool.checks().length, 8);
});

test("cache can be disabled and tool failures are never cached", async (t) => {
  const fixture = await createFixture({ "a.js": "bad" });
  t.after(() => fixture.cleanup());
  const tool = mockTool({
    exitCode: 2,
    stdout: "",
    stderr: "Invalid configuration",
  });
  const run = (cache: boolean) =>
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [prettierRule],
      process: tool.provider,
      cacheStore: new JsonFileRuleCacheStore(
        fixture.path(".local/cache/rules"),
      ),
      config: { rules: { "external/prettier": ["error", { cache }] } },
    });
  for (const cache of [true, true, false, false])
    await assert.rejects(run(cache), /Invalid configuration/);
  assert.equal(tool.checks().length, 4);
});

test("local JS binaries run through Node on Windows without .cmd shims", async (t) => {
  const fixture = await createFixture({
    "a.js": "bad",
    "node_modules/prettier/package.json": JSON.stringify({
      name: "prettier",
      version: "1.0.0",
      bin: { prettier: "bin/tool.cjs" },
    }),
    "node_modules/prettier/bin/tool.cjs": "",
  });
  t.after(() => fixture.cleanup());
  const tool = mockTool();
  await runQualityGate({
    root: fixture.root,
    mode: "full",
    rules: [prettierRule],
    process: tool.provider,
    config: { rules: { "external/prettier": "error" } },
  });
  assert.equal(tool.checks()[0]?.command, process.execPath);
  assert.equal(
    tool.checks()[0]?.args[0],
    fixture.path("node_modules/prettier/bin/tool.cjs"),
  );
});

test("reject mutating and protocol-changing flags before launching tools", async (t) => {
  const fixture = await createFixture({ "a.js": "bad" });
  t.after(() => fixture.cleanup());
  const tool = mockTool();
  for (const args of [
    ["--write"],
    ["--fix=true"],
    ["--cache"],
    ["--stdin-filepath=other.js"],
    ["--reporter=json"],
  ]) {
    await assert.rejects(
      runQualityGate({
        root: fixture.root,
        mode: "full",
        rules: [prettierRule],
        process: tool.provider,
        config: { rules: { "external/prettier": ["error", { args }] } },
      }),
      /read-only stdin protocol/,
    );
  }
  assert.equal(tool.calls.length, 0);
});

test("missing tools and malformed ESLint reports fail instead of silently passing", async (t) => {
  const fixture = await createFixture({ "a.js": "bad" });
  t.after(() => fixture.cleanup());
  const run = (rule: Rule, provider: ProcessProvider) =>
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [rule],
      process: provider,
      config: { rules: { [rule.metadata.id]: "error" } },
    });
  await assert.rejects(
    run(prettierRule, {
      async exec() {
        throw new Error("ENOENT");
      },
    }),
    /cannot run/,
  );
  await assert.rejects(
    run(
      eslintRule,
      mockTool({ exitCode: 0, stdout: "not json", stderr: "" }).provider,
    ),
  );
});

test("Biome connection failures are execution errors and do not poison the result cache", async (t) => {
  const fixture = await createFixture({ "a.js": "const x=1;\n" });
  t.after(() => fixture.cleanup());
  const result = {
    exitCode: 1,
    stdout: "",
    stderr: "No running instance of the Biome daemon server was found.",
  };
  const tool = mockTool(result);
  const run = () =>
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [biomeRule],
      process: tool.provider,
      cacheStore: new JsonFileRuleCacheStore(
        fixture.path(".local/cache/rules"),
      ),
      config: {
        rules: {
          "external/biome": ["error", { mode: "format", useServer: true }],
        },
      },
    });
  await assert.rejects(run(), /No running instance/);
  await assert.rejects(run(), /No running instance/);
  result.exitCode = 0;
  result.stdout = "const x = 1;\n";
  result.stderr = "";
  assert.equal((await run()).diagnostics.length, 1);
  await run();
  assert.equal(tool.checks().length, 3);
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

test("Biome defaults to snapshot formatting and rejects unreliable stdin check/lint modes", async (t) => {
  const fixture = await createFixture({ "a.js": "export const x = 1;\n" });
  t.after(() => fixture.cleanup());
  const tool = mockTool({
    exitCode: 0,
    stdout: "export const x = 1;\n",
    stderr: "",
  });
  const run = (setting: QualityGateConfig["rules"]) =>
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [biomeRule],
      process: tool.provider,
      config: { rules: setting },
    });
  assert.deepEqual((await run({ "external/biome": "error" })).diagnostics, []);
  assert.equal(tool.checks()[0]?.args[0], "format");
  for (const mode of ["check", "lint"]) {
    const before = tool.calls.length;
    await assert.rejects(
      run({ "external/biome": ["error", { mode }] }),
      /Run biome check or biome lint through shared checks/,
    );
    assert.equal(tool.calls.length, before);
  }
});
