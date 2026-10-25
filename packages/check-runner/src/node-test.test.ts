import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NodeProcessProvider } from "@slop-lab/qg-core";
import { createNodeTestCommand } from "./index.js";

test("Node test commands expand and deduplicate paths and run with the packaged reporter independently", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-node-command-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "tests with spaces"));
  const file = join(root, "tests with spaces/pass.test.mjs");
  await writeFile(
    file,
    "import {test} from 'node:test'; test('passes',()=>{});",
  );
  const command = createNodeTestCommand(root, {
    name: "tests",
    type: "node-test",
    files: ["tests with spaces/*.test.mjs", "tests with spaces/pass.test.mjs"],
  });
  assert.equal(command.command, process.execPath);
  assert.equal(command.env?.NODE_TEST_CONTEXT, undefined);
  assert.deepEqual(command.args.slice(2), [file]);
  assert.match(
    command.args[1] ?? "",
    /^--test-reporter=file:\/\/.*node-test-reporter\.m?js$/,
  );
  const result = await new NodeProcessProvider().exec({
    ...command,
    cwd: root,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "PASS\n");
  assert.throws(
    () =>
      createNodeTestCommand(root, {
        name: "missing",
        type: "node-test",
        files: ["missing/*.test.mjs"],
      }),
    /No test files matched/,
  );
});
