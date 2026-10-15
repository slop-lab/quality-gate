import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixture, runRule } from "@slop-lab/qg-test-utils";
import { validDocumentReferenceRule } from "./document-references.js";

test("reports each missing slash-delimited reference occurrence", async (t) => {
  const fixture = await createFixture({
    "docs/check.md": "real/target missing/target and missing/target\n",
    "real/target": "ok",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule: validDocumentReferenceRule });
  assert.equal(result.diagnostics.length, 2);
  assert.deepEqual(
    result.diagnostics.map((item) => item.column),
    [13, 32],
  );
  assert.match(result.diagnostics[0]?.message ?? "", /use a comma instead/);
});

test("suppression applies only to the immediately preceding occurrence", async (t) => {
  const fixture = await createFixture({
    "docs/check.md":
      "first/missing second/missing <!-- qg-suppress docs/valid-reference -->\n",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule: validDocumentReferenceRule });
  assert.deepEqual(
    result.diagnostics.map((item) => item.column),
    [1],
  );
});

test("changed mode checks only changed document paths", async (t) => {
  const fixture = await createFixture({
    "docs/a.md": "missing/one\n",
    "docs/b.md": "missing/two\n",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: validDocumentReferenceRule,
    mode: "changed",
    changes: [{ status: "modified", path: "docs/a.md" }],
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["docs/a.md"],
  );
});

test("shared suppression supports reasons and next-line scope for document references", async (t) => {
  const fixture = await createFixture({
    "docs/check.md":
      "<!-- qg-suppress-next-line docs/valid-reference: example path -->\nfirst/missing\nsecond/missing\n",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule: validDocumentReferenceRule });
  assert.deepEqual(
    result.diagnostics.map((item) => item.line),
    [3],
  );
});
