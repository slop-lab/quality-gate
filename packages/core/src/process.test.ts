import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeProcessProvider } from "./process.js";

test("process provider forwards stdin and merges configured environment with the host", async () => {
  const result = await new NodeProcessProvider().exec({
    command: process.execPath,
    args: [
      "-e",
      "process.stdin.setEncoding('utf8'); let input=''; process.stdin.on('data', x => input+=x); process.stdin.on('end', () => console.log(JSON.stringify([input,process.env.QG_TEST_VALUE,!!process.env.PATH])));",
    ],
    cwd: process.cwd(),
    env: { QG_TEST_VALUE: "configured" },
    input: "snapshot\n",
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), [
    "snapshot\n",
    "configured",
    true,
  ]);
});

test("process provider distinguishes tool exit codes from spawn failures and timeouts", async () => {
  const provider = new NodeProcessProvider();
  const options = { command: process.execPath, cwd: process.cwd() };
  assert.equal(
    (await provider.exec({ ...options, args: ["-e", "process.exit(2)"] }))
      .exitCode,
    2,
  );
  await assert.rejects(
    provider.exec({
      ...options,
      command: "qg-nonexistent-executable",
      args: [],
    }),
  );
  await assert.rejects(
    provider.exec({
      ...options,
      args: ["-e", "setInterval(()=>{},1000)"],
      timeoutMs: 100,
    }),
  );
});
