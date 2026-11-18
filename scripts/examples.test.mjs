// @ts-check
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, symlink } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createFixture } from "@slop-lab/qg-rule-testing";

const exec = promisify(execFile);
const cli = fileURLToPath(
  new URL("../packages/cli/dist/index.mjs", import.meta.url),
);
/** @type {Record<string, { testFile: string, files?: string[] }>} */
const examples = {
  "node-test": { testFile: "test/sum.test.mjs" },
  unittest: { testFile: "tests/test_sum.py" },
  jest: { testFile: "sum.test.cjs" },
  vitest: { testFile: "sum.test.mjs" },
  cargo: { testFile: "src/lib.rs", files: ["Cargo.toml", "Cargo.lock"] },
};

for (const [type, example] of Object.entries(examples)) {
  test(`${type} example passes through QG and reports a broken assertion`, async (t) => {
    const source = new URL(`../examples/${type}/`, import.meta.url);
    const paths = [
      ".gitattributes",
      ".gitignore",
      "README.md",
      "package.json",
      "qg.config.yaml",
      example.testFile,
      ...(example.files ?? []),
    ];
    const files = await Promise.all(
      paths.map(async (path) => [
        path,
        await readFile(new URL(path, source), "utf8"),
      ]),
    );
    const fixture = await createFixture(Object.fromEntries(files));
    t.after(() => fixture.cleanup());
    const cwd = fixture.root;
    const dependencies = fileURLToPath(new URL("node_modules", source));
    await symlink(dependencies, fixture.path("node_modules"), "junction");
    await exec("git", ["init", "--quiet"], { cwd });
    await exec("git", ["add", "--", ...paths], { cwd });

    /** @param {...string} args */
    const run = (...args) => exec(process.execPath, [cli, ...args], { cwd });
    assert.equal((await run("check", "--full")).stdout, "PASS\n");
    assert.equal((await run("run-hook", "pre-commit")).stdout, "PASS\n");
    if (type === "cargo") {
      // This scan sees the custom build output left by the preceding commands.
      assert.equal((await run("check", "--full")).stdout, "PASS\n");
    }

    const passingSource = await fixture.read(example.testFile);
    const failingSource = passingSource.replace("42", "43");
    assert.notEqual(failingSource, passingSource);
    await fixture.write(example.testFile, failingSource);
    for (const args of [
      ["check", "--full"],
      ["run-hook", "pre-commit"],
    ]) {
      await assert.rejects(run(...args, "--format", "json"), (error) => {
        const failure = /** @type {{ code: number, stdout: string }} */ (error);
        assert.equal(failure.code, 1);
        const { diagnostics } = JSON.parse(failure.stdout);
        assert.deepEqual(
          diagnostics.map(
            /** @param {{ruleId: string}} diagnostic */ (diagnostic) =>
              diagnostic.ruleId,
          ),
          [`checks/${type}`],
        );
        const { stdout, stderr } = diagnostics[0].metadata;
        assert.match(`${stdout}\n${stderr}`, /example[ _]sum/);
        return true;
      });
    }
  });
}
