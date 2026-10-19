import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { recommendedRules } from "@slop-lab/qg-rules-recommended";
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
  assert.equal(installed.path, path);
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
  const config = {
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
  await exec(process.execPath, [cli, "hooks", "install", "--root", root]);

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
  await exec(process.execPath, [cli, "check", "--staged", "--root", root]);
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
  assert.match(implicit.stdout, /No diagnostics/);
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
  assert.match(first.stderr, /QG setup: Installed/);
  assert.deepEqual(JSON.parse(first.stdout).diagnostics, []);
  const expected = await readFile(path, "utf8");
  assert.match(expected, /run-hook pre-commit/);
  assert.equal((await run()).stderr, "");
  await writeFile(path, expected.replace("run-hook pre-commit", "pre-commit"));
  assert.match(
    (await run("rules", "--format", "json")).stderr,
    /QG setup: Installed/,
  );
  assert.equal(await readFile(path, "utf8"), expected);
  const custom = "#!/bin/sh\n# Custom hook managed elsewhere\nexit 0\n";
  await writeFile(path, custom);
  const blocked = await run("check");
  assert.match(blocked.stderr, /Cannot automatically install.*already exists/);
  assert.equal(await readFile(path, "utf8"), custom);
});
