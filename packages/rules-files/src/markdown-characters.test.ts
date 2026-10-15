import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { type TestContext, test } from "node:test";
import { promisify } from "node:util";
import { type QualityGateConfig, runQualityGate } from "@slop-lab/qg-core";
import { createFixture } from "@slop-lab/qg-test-utils";
import { allowedMarkdownCharactersRule } from "./markdown-characters.js";
import { requireSuppressionReasonRule } from "./suppression-reason.js";

async function check(
  t: TestContext,
  content: string,
  options: Record<string, unknown> = {},
) {
  const fixture = await createFixture({ "doc.md": content });
  t.after(() => fixture.cleanup());
  return runQualityGate({
    root: fixture.root,
    mode: "full",
    fs: fixture.fs,
    rules: [allowedMarkdownCharactersRule, requireSuppressionReasonRule],
    config: { rules: { "markdown/allowed-characters": ["error", options] } },
  });
}

test("printable ASCII and normal Markdown whitespace are allowed everywhere", async (t) => {
  const ascii = Array.from({ length: 95 }, (_, index) =>
    String.fromCharCode(index + 32),
  ).join("");
  const result = await check(
    t,
    `${ascii}\n\tcode\r\n\`\`\`js\nconst value = 'quoted';\n\`\`\`\n`,
  );
  assert.deepEqual(result.diagnostics, []);
});

test("Unicode punctuation, invisible spaces, controls, and astral characters have exact locations", async (t) => {
  const result = await check(t, "“a”\r\nx\u00a0y\u200bz 😀“\n\u0000");
  assert.deepEqual(
    result.diagnostics.map((item) => [
      item.metadata?.codePoint,
      item.line,
      item.column,
      item.endColumn,
    ]),
    [
      ["U+201C", 1, 1, 2],
      ["U+201D", 1, 3, 4],
      ["U+00A0", 2, 2, 3],
      ["U+200B", 2, 4, 5],
      ["U+1F600", 2, 7, 9],
      ["U+201C", 2, 9, 10],
      ["U+0000", 3, 1, 2],
    ],
  );
});

test("language tags permit writing systems without permitting smart punctuation or invisible characters", async (t) => {
  const result = await check(
    t,
    "한글 日本語 かな カナ café cafe\u0301 → “\u200d",
    {
      allowedLanguages: ["ko-KR", "ja", "fr"],
      allowedCharacters: ["→"],
    },
  );
  assert.deepEqual(
    result.diagnostics.map((item) => item.metadata?.codePoint),
    ["U+201C", "U+200D"],
  );
  const english = await check(t, "café", { allowedLanguages: ["en-US"] });
  assert.equal(english.diagnostics[0]?.metadata?.codePoint, "U+00E9");
});

test("explicit scripts and characters extend the allowed set", async (t) => {
  const result = await check(t, "Ω Ж → 😀 “", {
    allowedLanguages: ["ru"],
    allowedScripts: ["Greek"],
    allowedCharacters: ["→", "😀"],
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.metadata?.codePoint),
    ["U+201C"],
  );
});

test("word suppression removes all violations in one word and preserves other words", async (t) => {
  const result = await check(
    t,
    "“first” “second” <!-- qg-suppress markdown/allowed-characters: quoted: source --> “third”",
  );
  assert.deepEqual(
    result.diagnostics.map((item) => item.metadata?.codePoint),
    ["U+201C", "U+201D", "U+201C", "U+201D"],
  );
  assert.equal(result.diagnostics[0]?.column, 1);
  assert.equal(result.diagnostics[1]?.column, 7);
});

test("line, next-line, and paired block suppressions preserve violations outside their scopes", async (t) => {
  const result = await check(
    t,
    [
      "“one” “two” <!-- qg-suppress-line markdown/allowed-characters: original quotation -->",
      "<!-- qg-suppress-next-line markdown/allowed-characters: example -->",
      "한글",
      "“outside”",
      "<!-- qg-suppress-start markdown/allowed-characters: verbatim excerpt -->",
      "日本語",
      "“quoted”",
      "<!-- qg-suppress-end -->",
      "“outside”",
    ].join("\n"),
  );
  assert.deepEqual(
    result.diagnostics.map((item) => item.line),
    [4, 4, 9, 9],
  );
});

test("missing reasons are errors on all suppression starts and cannot suppress themselves", async (t) => {
  const result = await check(
    t,
    [
      "한글 <!-- qg-suppress markdown/allowed-characters -->",
      "<!-- qg-suppress-line qg/require-suppression-reason:   -->",
      "<!-- qg-suppress-next-line markdown/allowed-characters -->",
      "한글",
      "<!-- qg-suppress-start markdown/allowed-characters -->",
      "한글",
      "<!-- qg-suppress-end -->",
    ].join("\n"),
  );
  assert.deepEqual(
    result.diagnostics.map((item) => [item.ruleId, item.line]),
    [
      ["qg/require-suppression-reason", 1],
      ["qg/require-suppression-reason", 2],
      ["qg/require-suppression-reason", 3],
      ["qg/require-suppression-reason", 5],
    ],
  );
});

test("project overrides, exclusions, extensions, and deleted paths are respected", async (t) => {
  const fixture = await createFixture({
    "docs/ko.MD": "한글",
    "docs/off.md": "“",
    "docs/generated.md": "“",
    "other.md": "“",
    "note.txt": "“",
    "node_modules/pkg/readme.md": "“",
  });
  t.after(() => fixture.cleanup());
  const config: QualityGateConfig = {
    rules: {
      "markdown/allowed-characters": [
        "error",
        { ignoredPaths: ["docs/generated.md"] },
      ],
    },
    overrides: [
      {
        files: ["docs/ko.MD"],
        rules: {
          "markdown/allowed-characters": [
            "warning",
            { allowedLanguages: ["ko"] },
          ],
        },
      },
      {
        files: ["docs/off.md"],
        rules: { "markdown/allowed-characters": "off" },
      },
    ],
  };
  const result = await runQualityGate({
    root: fixture.root,
    mode: "full",
    fs: fixture.fs,
    rules: [allowedMarkdownCharactersRule],
    config,
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["other.md"],
  );
  const changed = await runQualityGate({
    root: fixture.root,
    mode: "changed",
    fs: fixture.fs,
    rules: [allowedMarkdownCharactersRule],
    config,
    changedProvider: fixture.changedProvider([
      { status: "modified", path: "docs/ko.MD" },
      { status: "deleted", path: "other.md" },
    ]),
  });
  assert.deepEqual(changed.diagnostics, []);
  const custom = await runQualityGate({
    root: fixture.root,
    mode: "full",
    fs: fixture.fs,
    rules: [allowedMarkdownCharactersRule],
    config: {
      rules: {
        "markdown/allowed-characters": ["error", { extensions: [".txt"] }],
      },
    },
  });
  assert.deepEqual(
    custom.diagnostics.map((item) => item.path),
    ["note.txt"],
  );
});

test("invalid policy options fail with useful configuration errors", async (t) => {
  await assert.rejects(
    check(t, "ok", { allowedLanguages: ["not_a_language"] }),
    /invalid language tag/,
  );
  await assert.rejects(
    check(t, "ok", { allowedLanguages: ["xx"] }),
    /cannot determine script/,
  );
  await assert.rejects(
    check(t, "ok", { allowedScripts: ["InvalidScript"] }),
    /invalid Unicode script/,
  );
  await assert.rejects(
    check(t, "ok", { allowedCharacters: "x" }),
    /allowedCharacters must be an array/,
  );
});

test("staged checks read suppression reasons and text from the index", async (t) => {
  const fixture = await createFixture({
    "doc.md":
      "“word” <!-- qg-suppress markdown/allowed-characters: staged quotation -->\n",
  });
  t.after(() => fixture.cleanup());
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: fixture.root });
  await exec("git", ["add", "doc.md"], { cwd: fixture.root });
  await fixture.write(
    "doc.md",
    "“word” <!-- qg-suppress markdown/allowed-characters -->\n",
  );
  const options = {
    root: fixture.root,
    mode: "changed" as const,
    staged: true,
    rules: [allowedMarkdownCharactersRule, requireSuppressionReasonRule],
  };
  assert.deepEqual((await runQualityGate(options)).diagnostics, []);
  await exec("git", ["add", "doc.md"], { cwd: fixture.root });
  await fixture.write("doc.md", "ASCII working tree\n");
  const result = await runQualityGate(options);
  assert.deepEqual(
    result.diagnostics.map((item) => item.ruleId),
    ["qg/require-suppression-reason"],
  );
});
