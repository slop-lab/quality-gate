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
  version: "0.1.1",
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

test("repository provider accepts independently versioned public packages", async (t) => {
  const fixture = await createFixture(files());
  t.after(() => fixture.cleanup());
  assert.deepEqual(
    (await runRule({ fixture, rule, severity: "error" })).diagnostics,
    [],
  );
});

test("repository provider reports manifest mismatches and unpublished dependency protocols", async (t) => {
  const fixture = await createFixture({
    ...files({
      name: "@slop-lab/qg-other",
      dependencies: { "@slop-lab/qg-rules-files": "workspace:*" },
    }),
    "packages/rules-files/package.json": JSON.stringify({
      ...manifest,
      name: "@slop-lab/qg-rules-files",
      version: "0.1.1",
    }),
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule, severity: "error" });
  const message = result.diagnostics[0]?.message ?? "";
  assert.match(message, /name must be @slop-lab\/qg-core/);
  assert.match(message, /npm-publishable version/);
  assert.match(message, /must match packages\/rules-files\/package.json/);
});

test("a root metadata change rechecks unchanged workspace manifests", async (t) => {
  const fixture = await createFixture(files());
  t.after(() => fixture.cleanup());
  await fixture.write(
    "package.json",
    JSON.stringify({ ...release, license: "UNLICENSED" }),
  );
  const result = await runRule({
    fixture,
    rule,
    severity: "error",
    changes: [{ status: "modified", path: "package.json" }],
    mode: "changed",
  });
  assert.equal(result.diagnostics[0]?.path, "packages/core/package.json");
  assert.match(result.diagnostics[0]?.message ?? "", /UNLICENSED/);
});

test("a dependency release rechecks unchanged dependent manifests", async (t) => {
  const fixture = await createFixture({
    ...files({ dependencies: { "@slop-lab/qg-rules-files": "0.1.0" } }),
    "packages/rules-files/package.json": JSON.stringify({
      ...manifest,
      name: "@slop-lab/qg-rules-files",
      version: "0.1.0",
    }),
  });
  t.after(() => fixture.cleanup());
  await fixture.write(
    "packages/rules-files/package.json",
    JSON.stringify({
      ...manifest,
      name: "@slop-lab/qg-rules-files",
      version: "0.1.1",
    }),
  );
  const result = await runRule({
    fixture,
    rule,
    severity: "error",
    changes: [
      { status: "modified", path: "packages/rules-files/package.json" },
    ],
    mode: "changed",
  });
  assert.equal(result.diagnostics[0]?.path, "packages/core/package.json");
  assert.match(result.diagnostics[0]?.message ?? "", /0\.1\.1/);
});
