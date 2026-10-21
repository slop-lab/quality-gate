import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JsonFileRuleCacheStore,
  type ProcessExecOptions,
  type ProcessProvider,
  type ProcessResult,
  type QualityGateConfig,
  runQualityGate,
} from "@slop-lab/qg-core";
import { createFixture } from "@slop-lab/qg-test-utils";
import { biomeRule } from "./index.js";

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
    rules: [biomeRule],
    process: tool.provider,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(tool.calls.length, 0);
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
