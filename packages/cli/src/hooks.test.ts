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
import { installHooks } from "./hooks.js";

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
  const path = join(root, ".hooks", "pre-commit");
  const previous = "#!/bin/sh\nexit 7\n";
  await writeFile(path, previous);
  await assert.rejects(installHooks(root, cli), /already exists/);
  assert.equal(await readFile(path, "utf8"), previous);
  const installed = await installHooks(root, cli, true);
  assert.equal(installed.path, path);
  assert.ok(installed.backup);
  assert.equal(await readFile(installed.backup, "utf8"), previous);
  const content = await readFile(path, "utf8");
  assert.match(content, /pre-commit/);
  assert.equal((await installHooks(root, cli)).backup, undefined);
  assert.equal(await readFile(path, "utf8"), content);
  if (process.platform !== "win32") {
    await chmod(path, 0o644);
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
  await assert.rejects(git("hook", "run", "pre-commit"), /\["pre-commit"\]/);
});
