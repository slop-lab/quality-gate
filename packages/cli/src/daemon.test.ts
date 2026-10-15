import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { requestDaemon, startDaemon } from "./daemon.js";

test("project daemon handles check, ping, and stop over its local socket", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quality-gate-daemon-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const running = startDaemon(root, async (args) => ({
    code: 0,
    result: { mode: "changed", changes: [], diagnostics: [] },
    error: args.join(","),
  }));
  let ping = await requestDaemon(root, "ping");
  for (let attempt = 0; !ping && attempt < 20; attempt += 1) {
    await delay(10);
    ping = await requestDaemon(root, "ping");
  }
  assert.equal(ping?.code, 0);
  const checked = await requestDaemon(root, "check", ["check", "--staged"]);
  assert.equal(checked?.result?.mode, "changed");
  assert.equal(checked?.error, "check,--staged");
  assert.equal((await requestDaemon(root, "stop"))?.code, 0);
  await running;
  assert.equal(await requestDaemon(root, "ping"), undefined);
});
