import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { createRulesFromProvider } from "@slop-lab/qg-core";
import { createFixture, runRule } from "@slop-lab/qg-rule-testing";
import { cspellRule, ruleProvider, rules } from "./index.js";

const options = { files: ["**/*.md"] };

test("the standalone plugin exposes both rule and provider interfaces and remains opt-in", async (t) => {
  const fixture = await createFixture({ "README.md": "speling" });
  t.after(() => fixture.cleanup());
  assert.deepEqual(rules, [cspellRule]);
  assert.equal(
    (await createRulesFromProvider(ruleProvider))[0]?.metadata.id,
    "external/cspell",
  );
  assert.deepEqual(
    (await runRule({ fixture, rule: cspellRule })).diagnostics,
    [],
  );
});

test("CSpell returns actual words and UTF-16 locations for CRLF and Unicode text", async (t) => {
  const fixture = await createFixture({
    "README.md": "Hello world.\r\n😀 speling mistake.",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: cspellRule,
    severity: "error",
    options,
  });
  assert.equal(result.diagnostics.length, 1);
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic?.metadata?.word, "speling");
  assert.equal(diagnostic?.line, 2);
  assert.equal(diagnostic?.column, 4);
  assert.equal(diagnostic?.endColumn, 11);
  assert.match(diagnostic?.message ?? "", /speling/);
});

test("nearby CSpell configuration honors words, forbidden words, inline directives and ignored files", async (t) => {
  const fixture = await createFixture({
    "cspell.json": JSON.stringify({
      version: "0.2",
      words: ["qgcustomword"],
      flagWords: ["forbiddenword"],
      ignorePaths: ["skip.md"],
    }),
    "README.md":
      "qgcustomword forbiddenword\n<!-- cspell:ignore speling -->\nspeling",
    "skip.md": "speling",
    "nested/cspell.json": JSON.stringify({
      version: "0.2",
      words: ["speling"],
    }),
    "nested/document.md": "speling",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: cspellRule,
    severity: "error",
    options,
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.metadata?.word]),
    [["README.md", "forbiddenword"]],
  );
  assert.equal(result.diagnostics[0]?.metadata?.isFlagged, true);
});

test("project dictionary changes take effect between checks in the same process", async (t) => {
  const fixture = await createFixture({
    "cspell.json": JSON.stringify({
      version: "0.2",
      dictionaryDefinitions: [{ name: "project", path: "./words.txt" }],
      dictionaries: ["project"],
    }),
    "words.txt": "qgcustomword\n",
    "README.md": "qgcustomword speling",
  });
  t.after(() => fixture.cleanup());
  const check = () =>
    runRule({ fixture, rule: cspellRule, severity: "error", options });
  assert.deepEqual(
    (await check()).diagnostics.map((item) => item.metadata?.word),
    ["speling"],
  );
  await fixture.write("words.txt", "qgcustomword\nspeling\n");
  assert.deepEqual((await check()).diagnostics, []);
  await fixture.write("words.txt", "qgcustomword\n");
  assert.equal((await check()).diagnostics.length, 1);
});

test("QG selection, overrides, generated exemptions, binary files and recovery messages apply", async (t) => {
  const fixture = await createFixture({
    "docs/document.md": "speling",
    "skip/document.md": "speling",
    "disabled/document.md": "speling",
    "generated/document.md": "speling",
    "dist/document.md": "speling",
    "node_modules/document.md": "speling",
    "binary.md": "\0speling",
    "source.ts": "speling",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: cspellRule,
    config: {
      artifacts: { generated: { include: ["generated/**"] } },
      rules: {
        "external/cspell": {
          severity: "error",
          message: "Add intentional terms to the project dictionary.",
          options: { ...options, ignoredPaths: ["skip/**"] },
        },
      },
      overrides: [
        { files: ["disabled/**"], rules: { "external/cspell": "off" } },
        { files: ["docs/**"], rules: { "external/cspell": "warning" } },
      ],
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.path, item.severity, item.message]),
    [
      [
        "docs/document.md",
        "warning",
        "Add intentional terms to the project dictionary.",
      ],
    ],
  );
  const included = await runRule({
    fixture,
    rule: cspellRule,
    severity: "error",
    options: { files: ["generated/**"], includeGenerated: true },
    config: { artifacts: { generated: { include: ["generated/**"] } } },
  });
  assert.equal(included.diagnostics.length, 1);
});

test("changed scans deduplicate rename/copy destinations and skip missing/deleted files", async (t) => {
  const fixture = await createFixture({
    "new.md": "speling",
    "copy.md": "speling",
    "unchanged.md": "speling",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: cspellRule,
    severity: "error",
    options,
    mode: "changed",
    changes: [
      { status: "renamed", path: "new.md", oldPath: "old.md" },
      { status: "modified", path: "new.md" },
      { status: "copied", path: "copy.md", oldPath: "old.md" },
      { status: "deleted", path: "removed.md" },
      { status: "modified", path: "missing.md" },
    ],
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    ["copy.md", "new.md"],
  );
});

test("staged scans check index contents even after an unstaged correction", async (t) => {
  const fixture = await createFixture({ "README.md": "speling" });
  t.after(() => fixture.cleanup());
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: fixture.root });
  await exec("git", ["add", "."], { cwd: fixture.root });
  await fixture.write("README.md", "spelling");
  const staged = await runRule({
    fixture,
    rule: cspellRule,
    staged: true,
    severity: "error",
    options,
  });
  assert.equal(staged.diagnostics[0]?.metadata?.word, "speling");
  assert.deepEqual(
    (await runRule({ fixture, rule: cspellRule, severity: "error", options }))
      .diagnostics,
    [],
  );
});

test("explicit config paths resolve from the project root and config errors fail instead of passing", async (t) => {
  const fixture = await createFixture({
    "settings/spelling.json": JSON.stringify({
      version: "0.2",
      words: ["speling"],
    }),
    "README.md": "speling",
  });
  t.after(() => fixture.cleanup());
  const check = (configFile: string) =>
    runRule({
      fixture,
      rule: cspellRule,
      severity: "error",
      options: { ...options, configFile },
    });
  assert.deepEqual((await check("settings/spelling.json")).diagnostics, []);
  await assert.rejects(check("missing.json"), /external\/cspell: cannot check/);
  await fixture.write("broken.json", "{");
  await assert.rejects(check("broken.json"), /external\/cspell: cannot check/);
  await fixture.write(
    "bad-dictionary.json",
    JSON.stringify({
      version: "0.2",
      dictionaryDefinitions: [{ name: "bad", path: "./missing.txt" }],
      dictionaries: ["bad"],
    }),
  );
  await assert.rejects(
    check("bad-dictionary.json"),
    /external\/cspell: cannot check/,
  );
});
