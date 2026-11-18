import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixture, runRule } from "@slop-lab/qg-rule-testing";
import {
  noExtraTableCellWhitespaceRule,
  noRedundantTableRowNumbersRule,
} from "./markdown-table-style.js";

test("reports repeated Markdown table delimiter padding", async (t) => {
  const fixture = await createFixture({
    "README.md": `| Name | Meaning |
| --- | --- |
| first  | valid |
|  second | valid |
`,
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: noExtraTableCellWhitespaceRule,
  });
  assert.deepEqual(
    result.diagnostics.map(({ line, column, endColumn }) => ({
      line,
      column,
      endColumn,
    })),
    [
      { line: 3, column: 8, endColumn: 9 },
      { line: 4, column: 3, endColumn: 4 },
    ],
  );
});

test("allows formatter alignment with short delimiters and wide characters", async (t) => {
  const fixture = await createFixture({
    "README.md": `| 품목 |  상태  | Qty |
| :--- | :----: | --: |
| A    | 👩‍💻 New |   2 |
| 界   |        |     |

| A   |  B  |   C |
| :-- | :-: | --: |
| Z   |  X  |   1 |

| Name | Meaning |
| --- | --- |
|  | valid |
`,
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: noExtraTableCellWhitespaceRule,
  });
  assert.deepEqual(result.diagnostics, []);
});

test("reports misplaced padding in a column with aligned cells", async (t) => {
  const fixture = await createFixture({
    "README.md": `| Name  | Count |
| ----- | ----: |
| first |     1 |
|  next |     2 |
|  new   |     3 |
| new    |     4 |
`,
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: noExtraTableCellWhitespaceRule,
  });
  assert.deepEqual(
    result.diagnostics.map(({ line, column, endColumn }) => ({
      line,
      column,
      endColumn,
    })),
    [
      { line: 4, column: 3, endColumn: 4 },
      { line: 5, column: 3, endColumn: 4 },
      { line: 6, column: 6, endColumn: 7 },
    ],
  );
});

test("reports redundant first-column Markdown row numbers", async (t) => {
  const fixture = await createFixture({
    "README.md": `| Order | Package |
| --- | --- |
| 1 | core |
| 2 | cli |
`,
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: noRedundantTableRowNumbersRule,
  });
  assert.deepEqual(
    result.diagnostics.map(({ line, column, endColumn }) => ({
      line,
      column,
      endColumn,
    })),
    [
      { line: 3, column: 3, endColumn: 4 },
      { line: 4, column: 3, endColumn: 4 },
    ],
  );
});

test("allows numeric first-column data without a row-number header", async (t) => {
  const fixture = await createFixture({
    "README.md": `| Package | Meaning |
| --- | --- |
| 1 | core |
| 2 | cli |
`,
  });
  t.after(() => fixture.cleanup());
  assert.deepEqual(
    (await runRule({ fixture, rule: noRedundantTableRowNumbersRule }))
      .diagnostics,
    [],
  );
});

test("allows canonical tables and ignores table-like fenced code", async (t) => {
  const fixture = await createFixture({
    "README.md": `| Metric | Value |
| --- | ---: |
| retries | 1 |

\`\`\`md
| Order  | Package |
| --- | --- |
| 1 | core |
\`\`\`
`,
  });
  t.after(() => fixture.cleanup());
  for (const rule of [
    noExtraTableCellWhitespaceRule,
    noRedundantTableRowNumbersRule,
  ])
    assert.deepEqual((await runRule({ fixture, rule })).diagnostics, []);
});
