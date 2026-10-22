// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRulesFromProvider } from "@slop-lab/qg-core";
import { createFixture, runRule } from "@slop-lab/qg-rule-testing";
import { ruleProvider } from "./qg-rules.mjs";

const [rule] = await createRulesFromProvider(ruleProvider);
const release = {
  version: "0.1.0",
  license: "MIT",
  engines: { node: ">=24.0.0" },
};
const manifest = {
  ...release,
  name: "@slop-lab/qg-core",
  publishConfig: { access: "public" },
};

/** @param {Record<string, unknown>} changes */
function files(changes = {}) {
  return {
    "package.json": JSON.stringify(release),
    "packages/core/package.json": JSON.stringify({ ...manifest, ...changes }),
  };
}

test("repository provider accepts public packages matching the root release contract", async (t) => {
  const fixture = await createFixture(files());
  t.after(() => fixture.cleanup());
  assert.deepEqual(
    (await runRule({ fixture, rule, severity: "error" })).diagnostics,
    [],
  );
});

test("repository provider reports manifest mismatches and unpublished dependency protocols", async (t) => {
  const fixture = await createFixture(
    files({
      name: "@slop-lab/qg-other",
      version: "0.0.0",
      dependencies: { "@slop-lab/qg-core": "workspace:*" },
    }),
  );
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule, severity: "error" });
  const message = result.diagnostics[0]?.message ?? "";
  assert.match(message, /name must be @slop-lab\/qg-core/);
  assert.match(message, /version must match root/);
  assert.match(message, /npm-publishable version/);
});

test("a root release change rechecks unchanged workspace manifests", async (t) => {
  const fixture = await createFixture(files());
  t.after(() => fixture.cleanup());
  await fixture.write(
    "package.json",
    JSON.stringify({ ...release, version: "0.2.0" }),
  );
  const result = await runRule({
    fixture,
    rule,
    severity: "error",
    changes: [{ status: "modified", path: "package.json" }],
    mode: "changed",
  });
  assert.equal(result.diagnostics[0]?.path, "packages/core/package.json");
  assert.match(result.diagnostics[0]?.message ?? "", /0\.2\.0/);
});
