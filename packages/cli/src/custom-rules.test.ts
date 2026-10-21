import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { recommendedRules } from "@slop-lab/qg-rules-recommended";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("./index.mjs", import.meta.url));

test("CLI loads custom path rules from the project and shares staged behavior with hooks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg custom rules' "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => exec("git", args, { cwd: root });
  await git("init", "--quiet");
  const optional = join(root, "node_modules", "@slop-lab");
  await mkdir(optional, { recursive: true });
  await symlink(
    dirname(
      createRequire(
        createRequire(import.meta.url).resolve(
          "@slop-lab/qg-rules-recommended/package.json",
        ),
      ).resolve("@slop-lab/qg-core/package.json"),
    ),
    join(optional, "qg-core"),
    "junction",
  );
  await writeFile(
    join(root, "qg-rules.mjs"),
    `
import { createFilePathRule } from '@slop-lab/qg-core';
export const rules = [createFilePathRule({
  id: 'project/feature-name', name: 'Feature name', description: 'Match the parent directory',
  defaultOptions: { files: ['features/**/*.ts'] },
  validate(path) {
    const parts = path.split('/');
    if (parts.at(-1) !== parts.at(-2) + '.ts') return 'Match the feature directory';
  },
})];
`,
  );
  await writeFile(
    join(root, ".qg.yaml"),
    JSON.stringify({
      ruleModules: ["./qg-rules.mjs"],
      rules: {
        ...Object.fromEntries(
          recommendedRules.map((rule) => [rule.metadata.id, "off"]),
        ),
        "project/feature-name": {
          severity: "error",
          message: "Use the feature name as filename",
        },
      },
      hooks: { preCommit: { installation: "off" } },
    }),
  );
  await mkdir(join(root, "features/cart"), { recursive: true });
  await writeFile(join(root, "features/cart/Bad.ts"), "");
  await git("add", ".");
  await rename(
    join(root, "features/cart/Bad.ts"),
    join(root, "features/cart/cart.ts"),
  );
  const run = (...args: string[]) =>
    exec(process.execPath, [cli, ...args, "--root", root]);
  for (const args of [["check"], ["run-hook", "pre-commit"]]) {
    await assert.rejects(run(...args), (error: unknown) => {
      const result = error as { code: number; stdout: string };
      assert.equal(result.code, 1);
      assert.match(
        result.stdout,
        /features\/cart\/Bad.ts: Use the feature name as filename/,
      );
      return true;
    });
  }
  assert.equal((await run("check", "--full")).stdout, "PASS\n");
  assert.match((await run("rules")).stdout, /project\/feature-name/);
  await git("add", "--all");
  assert.equal((await run("check")).stdout, "PASS\n");
});

test("a CLI provider passes index contents to a Node subprocess and worktree contents for full scans", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg provider snapshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await exec("git", ["init", "--quiet"], { cwd: root });
  await writeFile(
    join(root, "qg-provider.mjs"),
    `
import { execPath } from 'node:process';
export const ruleProvider = {
  getRules() { return [{
    id: 'project/snapshot', name: 'Snapshot', description: 'Delegated snapshot',
    defaultSeverity: 'error', defaultEnabled: false, supports: ['changed', 'full'],
    scope: 'file', requires: ['fileContent'], fixable: 'none',
  }]; },
  async execute(request, services) {
    const content = await services.fs.readFile('source.ts');
    const result = await services.process.exec({ command: execPath, args: ['worker.mjs'], cwd: request.root,
      timeoutMs: 5000, input: JSON.stringify({ request, content }) });
    if (result.exitCode) throw new Error(result.stderr);
    return JSON.parse(result.stdout);
  },
};
`,
  );
  await writeFile(
    join(root, "worker.mjs"),
    `
let input = ''; for await (const chunk of process.stdin) input += chunk;
const { request, content } = JSON.parse(input);
console.log(JSON.stringify({ diagnostics: [{ ruleId: request.ruleId,
  severity: request.severity, scope: 'file', path: 'source.ts', message: content }] }));
`,
  );
  await writeFile(
    join(root, ".qg.yaml"),
    JSON.stringify({
      ruleModules: ["./qg-provider.mjs"],
      rules: {
        ...Object.fromEntries(
          recommendedRules.map((rule) => [rule.metadata.id, "off"]),
        ),
        "project/snapshot": "error",
      },
      hooks: { preCommit: { installation: "off" } },
    }),
  );
  await writeFile(join(root, "source.ts"), "index snapshot");
  await exec("git", ["add", "."], { cwd: root });
  await writeFile(join(root, "source.ts"), "worktree snapshot");
  for (const [args, expected] of [
    [["check"], "index snapshot"],
    [["run-hook", "pre-commit"], "index snapshot"],
    [["check", "--full"], "worktree snapshot"],
  ] as const) {
    await assert.rejects(
      exec(process.execPath, [cli, ...args, "--format", "json"], { cwd: root }),
      (error: unknown) => {
        const result = error as { code: number; stdout: string };
        assert.equal(result.code, 1);
        assert.equal(
          JSON.parse(result.stdout).diagnostics[0].message,
          expected,
        );
        return true;
      },
    );
  }
});
