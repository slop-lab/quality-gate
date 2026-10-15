import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentSuppressions } from "./suppression.js";
import type { Diagnostic } from "./types.js";

function diagnostic(
  line: number,
  column = 1,
  ruleId = "test/check",
): Diagnostic {
  return {
    ruleId,
    line,
    column,
    message: "test",
    severity: "error",
    scope: "file",
  };
}

test("word suppression covers only the preceding whitespace-delimited token", () => {
  const document = new DocumentSuppressions(
    "“one” “two”<!-- qg-suppress test/check: intentional quote --> “three”",
  );
  assert.equal(document.isSuppressed(diagnostic(1, 1)), false);
  assert.equal(document.isSuppressed(diagnostic(1, 7)), true);
  assert.equal(document.isSuppressed(diagnostic(1, 11)), true);
  assert.equal(document.isSuppressed(diagnostic(1, 7, "test/other")), false);
  assert.equal(
    document.isSuppressed({ ...diagnostic(1, 7), suppressible: false }),
    false,
  );
  assert.equal(document.directives[0]?.reason, "intentional quote");
});

test("line and next-line directives stay on their selected lines with CRLF", () => {
  const document = new DocumentSuppressions(
    [
      "first <!-- qg-suppress-line test/check: local exception -->",
      "second",
      "<!-- qg-suppress-next-line test/check, test/other: two checks -->",
      "fourth",
      "fifth",
    ].join("\r\n"),
  );
  assert.equal(document.isSuppressed(diagnostic(1)), true);
  assert.equal(document.isSuppressed(diagnostic(2)), false);
  assert.equal(document.isSuppressed(diagnostic(3)), false);
  assert.equal(document.isSuppressed(diagnostic(4)), true);
  assert.equal(document.isSuppressed(diagnostic(4, 1, "test/other")), true);
  assert.equal(document.isSuppressed(diagnostic(5)), false);
});

test("nested ranges close independently and an anonymous end closes the latest group", () => {
  const document = new DocumentSuppressions(
    [
      "outside",
      "<!-- qg-suppress-start test/check: outer -->",
      "outer",
      "<!-- qg-suppress-start test/check, test/other: inner -->",
      "inner",
      "<!-- qg-suppress-end -->",
      "outer again",
      "<!-- qg-suppress-end test/check -->",
      "outside again",
    ].join("\n"),
  );
  assert.equal(document.isSuppressed(diagnostic(1)), false);
  assert.equal(document.isSuppressed(diagnostic(3)), true);
  assert.equal(document.isSuppressed(diagnostic(5, 1, "test/other")), true);
  assert.equal(document.isSuppressed(diagnostic(7)), true);
  assert.equal(document.isSuppressed(diagnostic(7, 1, "test/other")), false);
  assert.equal(document.isSuppressed(diagnostic(9)), false);
});

test("unmatched ranges and word markers on a later line do not suppress", () => {
  const document = new DocumentSuppressions(
    [
      "word",
      "<!-- qg-suppress test/check: not the previous line -->",
      "<!-- qg-suppress-end test/check -->",
      "<!-- qg-suppress-start test/check: missing end -->",
      "must still be checked",
    ].join("\n"),
  );
  assert.equal(document.isSuppressed(diagnostic(1)), false);
  assert.equal(document.isSuppressed(diagnostic(5)), false);
});
