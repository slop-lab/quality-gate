import assert from "node:assert/strict";
import { test } from "node:test";
import { pluginFingerprint } from "./plugins.js";

test("plugin fingerprints change with identity, version, configuration, and order", () => {
  const base = [{ id: "references/markdown", version: "1" }];
  const fingerprint = pluginFingerprint(base);
  assert.notEqual(
    fingerprint,
    pluginFingerprint([{ id: "references/markdown", version: "2" }]),
  );
  assert.notEqual(
    fingerprint,
    pluginFingerprint([
      { id: "references/markdown", version: "1", cacheKey: "comments" },
    ]),
  );
  assert.notEqual(
    pluginFingerprint([...base, { id: "references/jsdoc", version: "1" }]),
    pluginFingerprint([{ id: "references/jsdoc", version: "1" }, ...base]),
  );
});

test("plugin fingerprints reject incomplete and duplicate identities", () => {
  assert.throws(() => pluginFingerprint([{ id: "", version: "1" }]), /id/);
  assert.throws(
    () => pluginFingerprint([{ id: "references/test", version: "" }]),
    /version/,
  );
  assert.throws(
    () =>
      pluginFingerprint([
        { id: "references/test", version: "1" },
        { id: "references/test", version: "2" },
      ]),
    /Duplicate plugin ID/,
  );
});
