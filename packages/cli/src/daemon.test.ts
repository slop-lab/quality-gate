import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { requestDaemon, startDaemon } from "./daemon.js";

test("project daemon handles check, ping, and stop over its local socket", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-daemon-"));
  const running = startDaemon(root, async (args) => ({
    code: 0,
    result: { mode: "changed", changes: [], diagnostics: [] },
    error: args.join(","),
  }));
  t.after(async () => {
    await requestDaemon(root, "stop");
    await running;
    await rm(root, { recursive: true, force: true });
  });
  await waitForDaemon(root);
  const checked = await requestDaemon(root, "check", ["check", "--staged"]);
  assert.equal(checked?.result?.mode, "changed");
  assert.equal(checked?.error, "check,--staged");
  assert.equal((await requestDaemon(root, "stop"))?.code, 0);
  await running;
  assert.equal(await requestDaemon(root, "ping"), undefined);
});

test("project daemons use independent endpoints and support restart", async (t) => {
  const first = await mkdtemp(join(tmpdir(), "qg-daemon-"));
  const second = await mkdtemp(join(tmpdir(), "qg-daemon-"));
  const runs: Promise<void>[] = [];
  t.after(async () => {
    await Promise.all(
      [first, second].map((root) => requestDaemon(root, "stop")),
    );
    await Promise.all(runs);
    await Promise.all(
      [first, second].map((root) => rm(root, { recursive: true, force: true })),
    );
  });
  await launch(first, "first");
  await launch(second, "second");

  assert.equal((await requestDaemon(first, "check"))?.error, "first");
  assert.equal((await requestDaemon(second, "check"))?.error, "second");
  assert.equal(
    (await requestDaemon(relative(process.cwd(), first), "check"))?.error,
    "first",
  );
  if (process.platform === "win32") {
    assert.equal(
      (await requestDaemon(first.toUpperCase(), "check"))?.error,
      "first",
    );
    // A second listener must fail without disrupting the running daemon.
    await assert.rejects(startDaemon(first, async () => ({ code: 0 })));
    assert.equal((await requestDaemon(first, "check"))?.error, "first");
  }

  assert.equal((await requestDaemon(first, "stop"))?.code, 0);
  await runs[0];
  assert.equal(await requestDaemon(first, "ping"), undefined);
  assert.equal((await requestDaemon(second, "check"))?.error, "second");
  await launch(first, "restarted");
  assert.equal((await requestDaemon(first, "check"))?.error, "restarted");

  async function launch(root: string, marker: string): Promise<void> {
    const running = startDaemon(root, async () => ({ code: 0, error: marker }));
    runs.push(running);
    await waitForDaemon(root);
  }
});

async function waitForDaemon(root: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await requestDaemon(root, "ping"))?.code === 0) return;
    await delay(10);
  }
  assert.fail("Daemon did not become ready");
}
