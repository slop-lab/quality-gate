import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { recommendedRules } from "@slop-lab/qg-rules-recommended";
import { requestDaemon, startDaemon } from "./daemon.js";
import { inspectPreCommitHook, installHooks } from "./hooks.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("./index.mjs", import.meta.url));

async function repository(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "qg hooks' "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) => exec("git", args, { cwd: root });
  await git("init", "--quiet");
  await git("config", "user.name", "QG Test");
  await git("config", "user.email", "qg@example.invalid");
  return { root, git };
}

test("hook installation respects hooksPath, is idempotent, and backs up an explicitly replaced hook", async (t) => {
  const { root, git } = await repository(t);
  await git("config", "core.hooksPath", ".hooks");
  await mkdir(join(root, ".hooks"));
  assert.match((await inspectPreCommitHook(root, cli)) ?? "", /not installed/);
  const path = join(root, ".hooks", "pre-commit");
  const previous = "#!/bin/sh\nexit 7\n";
  await writeFile(path, previous);
  await assert.rejects(installHooks(root, cli), /already exists/);
  assert.equal(await readFile(path, "utf8"), previous);
  const installed = await installHooks(root, cli, true);
  assert.equal(await realpath(installed.path), await realpath(path));
  assert.equal(await inspectPreCommitHook(root, cli), undefined);
  assert.ok(installed.backup);
  assert.equal(await readFile(installed.backup, "utf8"), previous);
  const content = await readFile(path, "utf8");
  assert.match(content, /pre-commit/);
  assert.equal((await installHooks(root, cli)).backup, undefined);
  assert.equal(await readFile(path, "utf8"), content);
  if (process.platform !== "win32") {
    await chmod(path, 0o644);
    assert.match(
      (await inspectPreCommitHook(root, cli)) ?? "",
      /not executable/,
    );
    await installHooks(root, cli);
    assert.ok((await stat(path)).mode & 0o111);
  }
});

test("installed pre-commit checks index contents and runs configured additional checks only in hook mode", async (t) => {
  const { root, git } = await repository(t);
  const optional = join(root, "node_modules", "@slop-lab");
  await mkdir(optional, { recursive: true });
  await symlink(
    dirname(
      createRequire(import.meta.url).resolve(
        "@slop-lab/qg-rules-package-json/package.json",
      ),
    ),
    join(optional, "qg-rules-package-json"),
    "junction",
  );
  const config = {
    ruleModules: ["@slop-lab/qg-rules-package-json"],
    scan: { defaultMode: "full" },
    rules: {
      ...Object.fromEntries(
        recommendedRules.map((rule) => [rule.metadata.id, "off"]),
      ),
      "package/allowed-name": {
        severity: "error",
        options: { allowedPatterns: ["allowed"] },
      },
    },
    hooks: {
      preCommit: {
        checks: [
          {
            name: "additional",
            command: process.execPath,
            args: [
              "-e",
              "if(require('node:fs').existsSync('fail-extra')) { console.error('additional failure'); process.exit(1); }",
            ],
            message: "Fix the additional check",
          },
        ],
      },
    },
  };
  await writeFile(join(root, ".qg.yaml"), JSON.stringify(config));
  await writeFile(join(root, "package.json"), '{"name":"allowed"}');
  // This unchanged manifest must stay outside a staged scan, despite defaultMode=full.
  await mkdir(join(root, "unchanged"));
  await writeFile(
    join(root, "unchanged", "package.json"),
    '{"name":"invalid"}',
  );
  await git("add", ".");
  await git("commit", "--quiet", "-m", "initial");
  const installation = await exec(process.execPath, [
    cli,
    "hooks",
    "install",
    "--root",
    root,
  ]);
  assert.equal(installation.stdout, "OK\n");
  assert.equal(installation.stderr, "");

  await writeFile(join(root, "package.json"), '{"name":"invalid"}');
  await git("add", "package.json");
  await writeFile(join(root, "package.json"), '{"name":"allowed"}');
  await assert.rejects(
    git("commit", "--quiet", "-m", "bad index"),
    /must match one of the allowed patterns/,
  );
  assert.equal(
    (await git("show", ":package.json")).stdout,
    '{"name":"invalid"}',
  );

  await git("add", "package.json");
  await writeFile(join(root, "package.json"), '{"name":"invalid"}');
  await writeFile(join(root, "fail-extra"), "");
  await assert.rejects(
    git("commit", "--quiet", "--allow-empty", "-m", "extra fails"),
    /Fix the additional check[\s\S]*additional failure/,
  );
  // Plain staged scans do not run hook-only commands.
  const checked = await exec(process.execPath, [
    cli,
    "check",
    "--staged",
    "--root",
    root,
  ]);
  assert.equal(checked.stdout, "PASS\n");
  assert.equal(checked.stderr, "");
  await rm(join(root, "fail-extra"));
  await git("commit", "--quiet", "--allow-empty", "-m", "valid index");
  assert.equal(
    (await git("show", "HEAD:package.json")).stdout,
    '{"name":"allowed"}',
  );
  assert.equal(
    await readFile(join(root, "package.json"), "utf8"),
    '{"name":"invalid"}',
  );
});

test("installed package hooks use the stable dependency path rather than a versioned package store", async (t) => {
  const { root, git } = await repository(t);
  const directory = join(root, "node_modules", "@slop-lab", "qg", "dist");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "index.mjs"),
    "console.log(JSON.stringify(process.argv.slice(2))); process.exit(3);\n",
  );
  const installed = await installHooks(root, "/versioned/store/qg/index.mjs");
  const content = await readFile(installed.path, "utf8");
  assert.match(content, /node_modules\/@slop-lab\/qg\/dist\/index.mjs/);
  assert.doesNotMatch(content, /versioned/);
  await assert.rejects(
    git("hook", "run", "pre-commit"),
    /\["run-hook","pre-commit"\]/,
  );
});

test("CLI startup verifies hooks outside rule results; implicit qg aliases check and off skips setup only", async (t) => {
  const { root } = await repository(t);
  const config = {
    rules: Object.fromEntries(
      recommendedRules.map((rule) => [rule.metadata.id, "off"]),
    ),
    hooks: {
      preCommit: {
        installation: "check",
        checks: [
          {
            name: "extra",
            command: process.execPath,
            args: ["-e", "process.exit(1)"],
            message: "extra failed",
          },
        ],
      },
    },
  };
  const save = () => writeFile(join(root, ".qg.yaml"), JSON.stringify(config));
  await save();
  const implicit = await exec(process.execPath, [cli], { cwd: root });
  const explicit = await exec(process.execPath, [cli, "check"], { cwd: root });
  assert.equal(implicit.stdout, explicit.stdout);
  assert.equal(implicit.stderr, explicit.stderr);
  assert.match(implicit.stderr, /QG setup warning:.*not installed/);
  assert.equal(implicit.stdout, "PASS\n");
  const json = await exec(
    process.execPath,
    [cli, "check", "--format", "json"],
    { cwd: root },
  );
  assert.deepEqual(JSON.parse(json.stdout).diagnostics, []);
  assert.match(json.stderr, /QG setup warning/);
  const help = await exec(process.execPath, [cli, "--help"], { cwd: root });
  assert.equal(help.stderr, "");
  assert.match(help.stdout, /qg run-hook pre-commit/);
  assert.doesNotMatch(help.stdout, /qg doctor/);
  await assert.rejects(
    exec(process.execPath, [cli, "pre-commit"], { cwd: root }),
    /Unknown command/,
  );
  await assert.rejects(
    exec(process.execPath, [cli, "run-hook", "unsupported"], { cwd: root }),
    /Usage: qg run-hook pre-commit/,
  );
  config.hooks.preCommit.installation = "off";
  await save();
  const disabled = await exec(process.execPath, [cli], { cwd: root });
  assert.equal(disabled.stderr, "");
  assert.equal(disabled.stdout, implicit.stdout);
  const cleared = await exec(
    process.execPath,
    [cli, "cache", "clear", "--rule", "test/unused"],
    { cwd: root },
  );
  assert.equal(cleared.stdout, "OK\n");
  assert.equal(cleared.stderr, "");
  await assert.rejects(
    exec(
      process.execPath,
      [cli, "run-hook", "pre-commit", "--format", "json"],
      { cwd: root },
    ),
    (error: unknown) => {
      const result = error as { stdout: string; stderr: string; code: number };
      assert.equal(result.code, 1);
      assert.equal(result.stderr, "");
      assert.equal(
        JSON.parse(result.stdout).diagnostics[0].message,
        "extra: extra failed",
      );
      return true;
    },
  );
});

test("automatic setup installs and updates managed hooks, honors hooksPath, and preserves custom hooks", async (t) => {
  const { root, git } = await repository(t);
  await git("config", "core.hooksPath", ".hooks");
  await writeFile(
    join(root, ".qg.yaml"),
    JSON.stringify({
      rules: Object.fromEntries(
        recommendedRules.map((rule) => [rule.metadata.id, "off"]),
      ),
      hooks: { preCommit: { installation: "auto" } },
    }),
  );
  const run = (...args: string[]) =>
    exec(process.execPath, [cli, ...args], { cwd: root });
  const path = join(root, ".hooks", "pre-commit");
  // Help never installs anything, even when automatic setup is configured.
  await run("--help");
  await assert.rejects(stat(path), /ENOENT/);
  const first = await run("check", "--format", "json");
  assert.equal(first.stderr, "");
  assert.deepEqual(JSON.parse(first.stdout).diagnostics, []);
  const expected = await readFile(path, "utf8");
  assert.match(expected, /run-hook pre-commit/);
  assert.equal((await run()).stderr, "");
  await writeFile(path, expected.replace("run-hook pre-commit", "pre-commit"));
  assert.equal((await run("rules", "--format", "json")).stderr, "");
  assert.equal(await readFile(path, "utf8"), expected);
  const custom = "#!/bin/sh\n# Custom hook managed elsewhere\nexit 0\n";
  await writeFile(path, custom);
  const blocked = await run("check");
  assert.match(blocked.stderr, /Cannot automatically install.*already exists/);
  assert.equal(await readFile(path, "utf8"), custom);
});

test("CLI node-test hook reports failures in text and JSON and stays out of ordinary rule scans", async (t) => {
  const { root } = await repository(t);
  await writeFile(
    join(root, ".qg.yaml"),
    JSON.stringify({
      rules: Object.fromEntries(
        recommendedRules.map((rule) => [rule.metadata.id, "off"]),
      ),
      hooks: {
        preCommit: {
          installation: "off",
          checks: [
            {
              name: "tests",
              type: "node-test",
              files: ["*.test.mjs"],
              message: "Fix Node tests",
            },
          ],
        },
      },
    }),
  );
  const file = join(root, "sample.test.mjs");
  await writeFile(
    file,
    `import { test } from 'node:test'; test('failing case', () => { throw new Error('node test detail'); });`,
  );
  const run = (...args: string[]) =>
    exec(process.execPath, [cli, ...args], { cwd: root });
  assert.equal((await run("check", "--staged")).stdout, "PASS\n");
  await assert.rejects(run("run-hook", "pre-commit"), (error: unknown) => {
    const result = error as { code: number; stdout: string };
    assert.equal(result.code, 1);
    assert.match(result.stdout, /Fix Node tests/);
    assert.match(result.stdout, /FAIL failing case/);
    assert.match(result.stdout, /node test detail/);
    return true;
  });
  await assert.rejects(
    run("run-hook", "pre-commit", "--format", "json"),
    (error: unknown) => {
      const result = error as { code: number; stdout: string };
      assert.equal(result.code, 1);
      const diagnostic = JSON.parse(result.stdout).diagnostics[0];
      assert.equal(diagnostic.ruleId, "checks/tests");
      assert.match(diagnostic.metadata.stdout, /FAIL failing case/);
      return true;
    },
  );
  await writeFile(
    file,
    `import { test } from 'node:test'; test('passing case', () => { console.log('hidden success'); });`,
  );
  const passed = await run("run-hook", "pre-commit");
  assert.equal(passed.stdout, "PASS\n");
  assert.equal(passed.stderr, "");
});

test("shared external and node-test checks run on qg, check and hooks, with a rules-only escape and no daemon duplication", async (t) => {
  const { root } = await repository(t);
  await writeFile(
    join(root, ".qg.yaml"),
    JSON.stringify({
      rules: Object.fromEntries(
        recommendedRules.map((rule) => [rule.metadata.id, "off"]),
      ),
      checks: [
        {
          name: "external",
          type: "command",
          command: process.execPath,
          args: [
            "-e",
            "require('node:fs').appendFileSync('runs', 'external\\n'); if(require('node:fs').existsSync('fail-external')) { console.error('external detail'); process.exit(1); }",
          ],
        },
        { name: "tests", type: "node-test", files: ["*.test.mjs"] },
      ],
      hooks: {
        preCommit: {
          installation: "off",
          checks: [
            {
              name: "hook-extra",
              command: process.execPath,
              args: [
                "-e",
                "require('node:fs').appendFileSync('runs', 'hook\\n')",
              ],
            },
          ],
        },
      },
    }),
  );
  const run = (...args: string[]) =>
    exec(process.execPath, [cli, ...args], { cwd: root });
  const testFile = join(root, "sample.test.mjs");
  await writeFile(
    testFile,
    `import { test } from 'node:test'; test('pass', () => {});`,
  );
  for (const args of [
    [],
    ["check"],
    ["check", "--full"],
    ["run-hook", "pre-commit"],
  ]) {
    const passed = await run(...args);
    assert.equal(passed.stdout, "PASS\n");
    assert.equal(passed.stderr, "");
    assert.equal(
      await readFile(join(root, "runs"), "utf8"),
      args[0] === "run-hook" ? "external\nhook\n" : "external\n",
    );
    await rm(join(root, "runs"));
  }
  await writeFile(
    testFile,
    `import { test } from 'node:test'; test('fails', () => { throw new Error('node detail'); });`,
  );
  await writeFile(join(root, "fail-external"), "");
  assert.equal((await run("--rules-only")).stdout, "PASS\n");
  await assert.rejects(readFile(join(root, "runs")), /ENOENT/);
  await assert.rejects(run("check", "--format", "json"), (error: unknown) => {
    const result = error as { code: number; stdout: string };
    assert.equal(result.code, 1);
    const diagnostics = JSON.parse(result.stdout).diagnostics;
    assert.deepEqual(
      diagnostics.map((diagnostic: { ruleId: string }) => diagnostic.ruleId),
      ["checks/external", "checks/tests"],
    );
    assert.match(diagnostics[0].metadata.stderr, /external detail/);
    assert.match(diagnostics[1].metadata.stdout, /node detail/);
    return true;
  });
  await assert.rejects(
    run("run-hook", "pre-commit", "--rules-only"),
    /does not support --rules-only/,
  );

  await rm(join(root, "runs"));
  await rm(join(root, "fail-external"));
  await writeFile(
    testFile,
    `import { test } from 'node:test'; test('pass', () => {});`,
  );
  await t.test(
    "daemon client runs external checks once",
    async (daemonTest) => {
      let scans = 0;
      const daemon = startDaemon(root, async () => {
        scans++;
        return {
          code: 0,
          result: { mode: "changed", changes: [], diagnostics: [] },
        };
      });
      daemonTest.after(async () => {
        await requestDaemon(root, "stop");
        await daemon;
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await requestDaemon(root, "ping"))?.code === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal((await requestDaemon(root, "ping"))?.code, 0);
      assert.equal((await run("check")).stdout, "PASS\n");
      assert.equal(scans, 1);
      assert.equal(await readFile(join(root, "runs"), "utf8"), "external\n");
    },
  );
});
