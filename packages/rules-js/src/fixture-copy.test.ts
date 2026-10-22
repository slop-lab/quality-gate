import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDiagnostic,
  createFixture,
  runRule,
} from "@slop-lab/qg-rule-testing";
import { noDirectoryFixtureCopyRule } from "./fixture-copy.js";

const directoryFixtureCopyCall = "createFixtureFrom" + "Directory";

test("reports tests that copy fixture directories", async (t) => {
  const fixture = await createFixture({
    "src/example.test.ts": `
      import { ${directoryFixtureCopyCall} } from "@slop-lab/qg-rule-testing";

      test("uses a broad fixture", async () => {
        await ${directoryFixtureCopyCall}(new URL("../fixtures/app", import.meta.url));
      });
    `,
  });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: noDirectoryFixtureCopyRule,
  });

  assert.equal(result.diagnostics.length, 1);
  assertDiagnostic(result.diagnostics[0], {
    ruleId: "test/no-directory-fixture-copy",
    severity: "warning",
    path: "src/example.test.ts",
    scope: "file",
  });
});

test("ignores focused inline fixtures", async (t) => {
  const fixture = await createFixture({
    "src/example.test.ts": `
      import { createFixture } from "@slop-lab/qg-rule-testing";

      test("uses a focused fixture", async () => {
        await createFixture({ "package.json": "{}" });
      });
    `,
  });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: noDirectoryFixtureCopyRule,
  });

  assert.equal(result.diagnostics.length, 0);
});

test("changed scan only reads changed test files", async (t) => {
  const fixture = await createFixture({
    "src/example.test.ts": `
      await ${directoryFixtureCopyCall}(new URL("../fixtures/app", import.meta.url));
    `,
    "src/other.test.ts": `
      await ${directoryFixtureCopyCall}(new URL("../fixtures/other", import.meta.url));
    `,
  });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: noDirectoryFixtureCopyRule,
    mode: "changed",
    changes: [{ status: "modified", path: "src/example.test.ts" }],
  });

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.path, "src/example.test.ts");
});

test("syntax-aware fixture checks ignore comments, strings and example source but inspect template expressions", async (t) => {
  const fixture = await createFixture({
    "example.test.ts": `
// createFixtureFromDirectory('comment');
const text = "createFixtureFromDirectory('literal')";
const sample = \`createFixtureFromDirectory('example')\`;
const interpolation = \`value: \${createFixtureFromDirectory('actual')}\`;
`,
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule: noDirectoryFixtureCopyRule });
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.line, 5);
});

test("fixture checks find aliased imports and namespace calls", async (t) => {
  const fixture = await createFixture({
    "example.test.ts": `
import { createFixtureFromDirectory as broad } from '@slop-lab/qg-rule-testing';
broad('actual');
fixtures.createFixtureFromDirectory('actual');
`,
  });
  t.after(() => fixture.cleanup());
  assert.equal(
    (await runRule({ fixture, rule: noDirectoryFixtureCopyRule })).diagnostics
      .length,
    2,
  );
});
