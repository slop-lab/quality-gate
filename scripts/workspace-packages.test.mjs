// @ts-check
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { test } from "node:test";
import { createFixture } from "@slop-lab/qg-rule-testing";
import {
  cleanWorkspaceBuildOutputs,
  findWorkspacePackages,
} from "./workspace-packages.mjs";

test("workspace discovery skips build leftovers from removed or renamed packages", async (t) => {
  const fixture = await createFixture({
    "current/package.json": '{"name":"@this-project/current"}',
    "current/src/index.ts": "export {};",
    "renamed-old/dist/index.mjs": "export {};",
    "removed/tsconfig.tsbuildinfo": "{}",
    "README.md": "# Packages\n",
  });
  t.after(() => fixture.cleanup());
  assert.deepEqual(
    findWorkspacePackages(fixture.root).map((path) => basename(path)),
    ["current"],
  );
});

test("workspace discovery retains package candidates with invalid manifests for build validation", async (t) => {
  const fixture = await createFixture({
    "broken/package.json": "invalid JSON",
  });
  t.after(() => fixture.cleanup());
  assert.deepEqual(
    findWorkspacePackages(fixture.root).map((path) => basename(path)),
    ["broken"],
  );
});

test("build cleanup removes current and orphaned outputs while preserving source and package data", async (t) => {
  const fixture = await createFixture({
    "current/package.json": '{"name":"@this-project/current"}',
    "current/src/current.test.ts": "export {};",
    "current/dist/removed.test.js": "export {};",
    "current/tsconfig.tsbuildinfo": "{}",
    "renamed-old/dist/removed.test.js": "export {};",
    "renamed-old/notes.txt": "Keep this file.",
  });
  t.after(() => fixture.cleanup());
  cleanWorkspaceBuildOutputs(fixture.root);
  assert.equal(existsSync(fixture.path("current/dist")), false);
  assert.equal(existsSync(fixture.path("renamed-old/dist")), false);
  assert.equal(await fixture.read("current/src/current.test.ts"), "export {};");
  assert.equal(await fixture.read("current/tsconfig.tsbuildinfo"), "{}");
  assert.equal(await fixture.read("renamed-old/notes.txt"), "Keep this file.");
  assert.deepEqual(
    findWorkspacePackages(fixture.root).map((path) => basename(path)),
    ["current"],
  );
  cleanWorkspaceBuildOutputs(fixture.root);
});
