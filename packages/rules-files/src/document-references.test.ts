import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { JsonFileRuleCacheStore } from "@slop-lab/qg-core";
import { createFixture, runRule } from "@slop-lab/qg-rule-testing";
import { validDocumentReferenceRule } from "./document-references.js";

const exec = promisify(execFile);

for (const referenceStyle of ["slash-delimited", "markdown-links"] as const) {
  for (const rewrite of [false, true]) {
    test(`${referenceStyle} rechecks cached untouched documents after a staged target move (${rewrite ? "delete/add" : "rename"})`, async (t) => {
      const reference =
        referenceStyle === "slash-delimited"
          ? "assets/target"
          : "[target](../assets/target)";
      const fixture = await createFixture({
        "docs/check.md": `${reference}\n`,
        "assets/target": "original target\n",
      });
      t.after(() => fixture.cleanup());
      const git = (...args: string[]) =>
        exec("git", args, { cwd: fixture.root });
      await git("init", "--quiet");
      await git("add", ".");
      await git(
        "-c",
        "user.name=QG Test",
        "-c",
        "user.email=qg@example.invalid",
        "commit",
        "--quiet",
        "--no-gpg-sign",
        "-m",
        "initial",
      );
      const cacheStore = new JsonFileRuleCacheStore(
        fixture.path(".local/cache"),
      );
      const options = { referenceStyle };
      assert.deepEqual(
        (
          await runRule({
            fixture,
            rule: validDocumentReferenceRule,
            options,
            cacheStore,
          })
        ).diagnostics,
        [],
      );

      await git("mv", "assets/target", "assets/moved");
      if (rewrite) {
        await fixture.write("assets/moved", "entirely different content\n");
        await git("add", "assets/moved");
      }
      // An untracked copy at the old path must not hide the broken index reference.
      await fixture.write("assets/target", "original target\n");
      const result = await runRule({
        fixture,
        rule: validDocumentReferenceRule,
        options,
        cacheStore,
        staged: true,
      });
      assert.deepEqual(
        result.changes.map((change) => change.status).sort(),
        rewrite ? ["added", "deleted"] : ["renamed"],
      );
      assert.equal(result.diagnostics.length, 1);
      assert.equal(result.diagnostics[0]?.path, "docs/check.md");
      assert.equal(result.diagnostics[0]?.severity, "error");
      assert.match(result.diagnostics[0]?.message ?? "", /assets\/target/);

      await fixture.write(
        "docs/check.md",
        referenceStyle === "slash-delimited"
          ? "assets/moved\n"
          : "[target](../assets/moved)\n",
      );
      await git("add", "docs/check.md");
      assert.deepEqual(
        (
          await runRule({
            fixture,
            rule: validDocumentReferenceRule,
            options,
            cacheStore,
            staged: true,
          })
        ).diagnostics,
        [],
      );
    });
  }
}

test("reports each missing slash-delimited reference occurrence", async (t) => {
  const fixture = await createFixture({
    "docs/check.md": "real/target missing/target and missing/target\n",
    "real/target": "ok",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: validDocumentReferenceRule,
    options: { referenceStyle: "slash-delimited" },
  });
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
  const result = await runRule({
    fixture,
    rule: validDocumentReferenceRule,
    options: { referenceStyle: "slash-delimited" },
  });
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
    options: { referenceStyle: "slash-delimited" },
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
  const result = await runRule({
    fixture,
    rule: validDocumentReferenceRule,
    options: { referenceStyle: "slash-delimited" },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.line),
    [3],
  );
});

test("Markdown mode validates local links, images and reference links relative to their document", async (t) => {
  const fixture = await createFixture({
    "docs/check.md": `[root](/README.md) [parent](../README.md#title) [directory](../assets/)
[space](../assets/my%20file.txt) ![image](../assets/image.svg) [missing](missing.md)
[reference][guide]

[guide]: ../missing.md
`,
    "README.md": "# Title",
    "assets/my file.txt": "",
    "assets/image.svg": "",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({ fixture, rule: validDocumentReferenceRule });
  assert.deepEqual(
    result.diagnostics.map((item) => [item.line, item.message]),
    [
      [
        2,
        "Local Markdown target does not exist: missing.md (resolved to docs/missing.md).",
      ],
      [
        3,
        "Local Markdown target does not exist: ../missing.md (resolved to missing.md).",
      ],
    ],
  );
});

test("Markdown parsing ignores URLs, code examples, slash prose, and comments", async (t) => {
  const fixture = await createFixture({
    "README.md": `normal input/output prose and @scope/package
[web](https://example.invalid/file) [email](mailto:example@example.com) [anchor](#title)
\`[example](missing.md)\`

\`\`\`md
[example](missing.md)
\`\`\`
<!-- [example](missing.md) -->
`,
  });
  t.after(() => fixture.cleanup());
  assert.deepEqual(
    (await runRule({ fixture, rule: validDocumentReferenceRule })).diagnostics,
    [],
  );
});

test("removing a target rechecks untouched documents against the staged filesystem", async (t) => {
  const fixture = await createFixture({
    "docs/check.md": "[target](../removed.txt)",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: validDocumentReferenceRule,
    mode: "changed",
    changes: [{ status: "deleted", path: "removed.txt" }],
  });
  assert.equal(result.diagnostics[0]?.path, "docs/check.md");
});
