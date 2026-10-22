import assert from "node:assert/strict";
import { test } from "node:test";
import { runQualityGate } from "@slop-lab/qg-core";
import { createFixture } from "@slop-lab/qg-rule-test-utils";
import { createStdinRule, validateStdinArgs } from "./index.js";

test("custom stdin protocols run without any built-in tool registration", async (t) => {
  const fixture = await createFixture({ "input.txt": "invalid\n" });
  t.after(() => fixture.cleanup());
  const rule = createStdinRule({
    id: "project/text-validator",
    name: "Text validator",
    description: "Project text policy",
    packageName: "project-text-validator",
    binaryName: "project-text-validator",
    files: ["**/*.txt"],
    defaultOptions: {
      command: process.execPath,
      commandArgs: [
        "-e",
        "if(process.argv.includes('--version')) console.log('1.0.0'); else {process.stdin.setEncoding('utf8'); let text=''; process.stdin.on('data',chunk=>text+=chunk); process.stdin.on('end',()=>{if(text.includes('invalid')) {console.error('rejected text'); process.exitCode=1;}});}",
      ],
      cache: false,
    },
    validateOptions(options) {
      validateStdinArgs("project/text-validator", options.args ?? []);
    },
    args: (_path, options) => ["--", ...(options.args ?? [])],
    diagnostics(path, _options, _input, result) {
      if (result.exitCode > 1) throw new Error(result.stderr);
      return result.exitCode === 0
        ? []
        : [
            {
              ruleId: "project/text-validator",
              severity: "error",
              scope: "file",
              path,
              message: result.stderr.trim(),
            },
          ];
    },
  });
  const run = () =>
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [rule],
      config: { rules: { "project/text-validator": "error" } },
    });
  assert.equal((await run()).diagnostics[0]?.message, "rejected text");
  await fixture.write("input.txt", "valid\n");
  assert.deepEqual((await run()).diagnostics, []);
});

test("missing executables fail with the custom package's installation guidance", async (t) => {
  const fixture = await createFixture({ "input.txt": "text" });
  t.after(() => fixture.cleanup());
  const rule = createStdinRule({
    id: "project/missing",
    name: "Missing",
    description: "Missing command",
    packageName: "project-validator",
    binaryName: "project-validator",
    files: ["**/*.txt"],
    validateOptions() {},
    args: () => [],
    diagnostics: () => [],
  });
  await assert.rejects(
    runQualityGate({
      root: fixture.root,
      mode: "full",
      rules: [rule],
      config: { rules: { "project/missing": "error" } },
      process: {
        async exec() {
          throw new Error("ENOENT");
        },
      },
    }),
    /Install project-validator locally/,
  );
});
