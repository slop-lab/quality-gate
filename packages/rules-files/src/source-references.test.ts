import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";
import { JsonFileRuleCacheStore } from "@slop-lab/qg-core";
import { createFixture, runRule } from "@slop-lab/qg-rule-testing";
import {
  createValidFileReferenceRule,
  type FileReferencePlugin,
} from "./file-references.js";
import { validSourceReferenceRule } from "./source-references.js";

test("validates Markdown file references in whole-line source comments", async (t) => {
  const fixture = await createFixture({
    "src/index.ts": `${"//"} [schema](../schema.json)
${"///"} [missing](./missing.ts)
${"//!"} [guide](/docs/guide.md#usage)
const example = "// [not a comment](missing.ts)";
const value = 1; // [inline comments are ignored](missing.ts)
`,
    "schema.json": "{}\n",
    "docs/guide.md": "# Guide\n",
  });
  t.after(() => fixture.cleanup());

  const result = await runRule({ fixture, rule: validSourceReferenceRule });
  assert.equal(result.diagnostics.length, 1);
  assert.deepEqual(result.diagnostics[0], {
    ruleId: "source/valid-reference",
    severity: "error",
    message:
      "Local file reference does not exist: ./missing.ts (resolved to src/missing.ts).",
    path: "src/index.ts",
    line: 2,
    column: 15,
    endLine: 2,
    endColumn: 27,
    scope: "file",
    metadata: {
      pluginId: "qg/source-comment-markdown",
      target: "src/missing.ts",
    },
    suggestedFix: {
      message: "Create the target or update the local reference.",
    },
  });
});

test("a target deletion rechecks untouched source files", async (t) => {
  const fixture = await createFixture({
    "src/index.ts": "// [schema](../schema.json)\n",
    "schema.json": "{}\n",
  });
  t.after(() => fixture.cleanup());
  assert.deepEqual(
    (await runRule({ fixture, rule: validSourceReferenceRule })).diagnostics,
    [],
  );

  await rm(fixture.path("schema.json"));
  const result = await runRule({
    fixture,
    rule: validSourceReferenceRule,
    mode: "changed",
    changes: [{ status: "deleted", path: "schema.json" }],
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.path, "src/index.ts");
});

test("external modules can compose a rule from custom extractor plugins", async (t) => {
  const plugin: FileReferencePlugin = {
    id: "example/config-reference",
    version: "1",
    supports: (path) => path.endsWith(".cfg"),
    extract: ({ content }) =>
      content
        .split(/\r?\n/)
        .flatMap((line, index) =>
          line.startsWith("ref=")
            ? [{ reference: line.slice(4), line: index + 1, column: 5 }]
            : [],
        ),
  };
  const rule = createValidFileReferenceRule({
    id: "example/valid-config-reference",
    name: "Valid config reference",
    description: "Checks example config references.",
    plugins: [plugin],
  });
  const fixture = await createFixture({ "app.cfg": "ref=missing.txt\n" });
  t.after(() => fixture.cleanup());

  const result = await runRule({ fixture, rule });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(
    result.diagnostics[0]?.metadata?.pluginId,
    "example/config-reference",
  );
});

test("adding an extractor plugin invalidates cached occurrences", async (t) => {
  const fixture = await createFixture({ "src/index.ts": "reference\n" });
  t.after(() => fixture.cleanup());
  const cacheStore = new JsonFileRuleCacheStore(fixture.path(".local/cache"));
  const noReferences: FileReferencePlugin = {
    id: "example/base",
    version: "1",
    supports: () => true,
    extract: () => [],
  };
  const addedPlugin: FileReferencePlugin = {
    id: "example/added",
    version: "1",
    supports: () => true,
    extract: () => [{ reference: "missing.txt", line: 1, column: 1 }],
  };
  const createRule = (plugins: FileReferencePlugin[]) =>
    createValidFileReferenceRule({
      id: "example/cache-invalidation",
      name: "Cache invalidation",
      description: "Tests plugin-aware cache keys.",
      plugins,
    });

  assert.deepEqual(
    (
      await runRule({
        fixture,
        rule: createRule([noReferences]),
        cacheStore,
      })
    ).diagnostics,
    [],
  );
  const result = await runRule({
    fixture,
    rule: createRule([noReferences, addedPlugin]),
    cacheStore,
  });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.metadata?.pluginId, "example/added");
});
