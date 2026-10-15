import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cacheKey, JsonFileRuleCacheStore } from "./cache.js";

test("rule cache persists values and isolates rule namespaces", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "quality-gate-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = new JsonFileRuleCacheStore(root);
  await first.forRule("docs/valid-reference").set("path", { parsed: true });

  const restarted = new JsonFileRuleCacheStore(root);
  assert.deepEqual(
    await restarted.forRule("docs/valid-reference").get("path"),
    { parsed: true },
  );
  assert.equal(await restarted.forRule("other/rule").get("path"), undefined);

  await restarted.clearRule("docs/valid-reference");
  assert.equal(
    await new JsonFileRuleCacheStore(root)
      .forRule("docs/valid-reference")
      .get("path"),
    undefined,
  );
});

test("cacheKey is content addressed", () => {
  assert.equal(
    cacheKey("a", new TextEncoder().encode("b")),
    cacheKey("a", "b"),
  );
  assert.notEqual(cacheKey("a", "b"), cacheKey("a", "c"));
});
