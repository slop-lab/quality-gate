import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { recommendedRules } from "@slop-lab/qg-rules-recommended";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("./index.mjs", import.meta.url));

test("standalone CSpell loads through ruleModules without the JS preset and checks staged content in CLI and hooks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-cspell-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "node_modules", "@slop-lab");
  await mkdir(target, { recursive: true });
  await symlink(
    dirname(
      createRequire(import.meta.url).resolve(
        "@slop-lab/qg-rules-cspell/package.json",
      ),
    ),
    join(target, "qg-rules-cspell"),
    "junction",
  );
  await writeFile(
    join(root, ".qg.yaml"),
    JSON.stringify({
      ruleModules: ["@slop-lab/qg-rules-cspell"],
      rules: {
        ...Object.fromEntries(
          recommendedRules.map((rule) => [rule.metadata.id, "off"]),
        ),
        "external/cspell": {
          severity: "error",
          options: { files: ["**/*.md"] },
        },
      },
      hooks: { preCommit: { installation: "off" } },
    }),
  );
  await writeFile(join(root, "README.md"), "speling");
  await exec("git", ["init", "--quiet"], { cwd: root });
  await exec("git", ["add", "."], { cwd: root });
  await writeFile(join(root, "README.md"), "spelling");
  const run = (...args: string[]) =>
    exec(process.execPath, [cli, ...args, "--root", root]);
  for (const args of [[], ["run-hook", "pre-commit"]]) {
    await assert.rejects(run(...args, "--format", "json"), (error: unknown) => {
      const result = error as { code: number; stdout: string };
      assert.equal(result.code, 1);
      const diagnostic = JSON.parse(result.stdout).diagnostics[0];
      assert.equal(diagnostic.ruleId, "external/cspell");
      assert.equal(diagnostic.path, "README.md");
      assert.equal(diagnostic.line, 1);
      assert.equal(diagnostic.column, 1);
      assert.equal(diagnostic.metadata.word, "speling");
      return true;
    });
  }
  assert.equal((await run("check", "--full")).stdout, "PASS\n");
  assert.match((await run("rules")).stdout, /external\/cspell/);
});
