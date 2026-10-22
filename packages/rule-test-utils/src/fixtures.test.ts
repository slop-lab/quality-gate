import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  type Diagnostic,
  JsonFileRuleCacheStore,
  type Rule,
} from "@slop-lab/qg-core";
import {
  assertDiagnostic,
  createFixture,
  createFixtureFromDirectory,
  runRule,
} from "./fixtures.js";

interface Options {
  limit: number;
  prefix: string;
}
const rule: Rule<Options> = {
  metadata: {
    id: "example/limit",
    name: "limit",
    description: "Example length rule",
    defaultSeverity: "error",
    defaultOptions: { limit: 10, prefix: "default" },
    supports: ["full", "changed"],
    scope: "file",
    requires: ["fileContent"],
    fixable: "suggestion",
    ignoreGeneratedArtifacts: true,
  },
  async check(context) {
    const diagnostics: Diagnostic[] = [];
    for (const path of ["input.txt", "nested/input.txt"]) {
      const resolved = context.resolveConfig(path);
      if (!resolved.enabled || !(await context.fs.isFile(path))) continue;
      const content = await context.fs.readFile(path);
      if (content.length > resolved.options.limit)
        diagnostics.push({
          ruleId: rule.metadata.id,
          severity: context.severity,
          path,
          scope: "file",
          message: `${resolved.options.prefix}: ${content.length}`,
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: content.length + 1,
          metadata: { content },
          suggestedFix: { message: "Shorten the input" },
        });
    }
    return diagnostics;
  },
};

test("typed shorthand options merge with root config while path overrides keep precedence", async (t) => {
  const fixture = await createFixture({
    "input.txt": "12345",
    "nested/input.txt": "12345",
  });
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule,
    options: { limit: 2 },
    severity: "warning",
    config: {
      rules: {
        "example/limit": ["error", { limit: 100, prefix: "configured" }],
      },
      overrides: [
        {
          files: ["nested/**"],
          rules: { "example/limit": ["info", { prefix: "nested" }] },
        },
      ],
    },
  });
  assert.equal(result.diagnostics.length, 2);
  assertDiagnostic(result.diagnostics[0], {
    severity: "warning",
    message: "configured: 5",
    line: 1,
    column: 1,
    endLine: 1,
    endColumn: 6,
    metadata: { content: "12345" },
    suggestedFix: { message: "Shorten the input" },
  });
  assertDiagnostic(result.diagnostics[1], {
    severity: "info",
    message: "nested: 5",
  });
  assert.equal(rule.metadata.defaultOptions?.limit, 10);
});

test("shorthand preserves configured messages and disabled state unless severity explicitly enables the rule", async (t) => {
  const fixture = await createFixture({ "input.txt": "12345" });
  t.after(() => fixture.cleanup());
  const config = {
    rules: {
      "example/limit": {
        severity: "off" as const,
        message: "Recovery instructions",
      },
    },
  };
  assert.deepEqual(
    (await runRule({ fixture, rule, config, options: { limit: 1 } }))
      .diagnostics,
    [],
  );
  const result = await runRule({
    fixture,
    rule,
    config,
    options: { limit: 1 },
    severity: "error",
  });
  assertDiagnostic(result.diagnostics[0], { message: "Recovery instructions" });
  const disabled: Rule<Options> = {
    ...rule,
    metadata: { ...rule.metadata, defaultEnabled: false },
  };
  assert.deepEqual(
    (await runRule({ fixture, rule: disabled, options: { limit: 1 } }))
      .diagnostics,
    [],
  );
  assert.equal(
    (
      await runRule({
        fixture,
        rule: disabled,
        options: { limit: 1 },
        severity: "warning",
      })
    ).diagnostics.length,
    1,
  );
});

test("changed scans support synthetic changes and custom providers without requiring Git", async (t) => {
  const fixture = await createFixture({ "input.txt": "12345" });
  t.after(() => fixture.cleanup());
  const changes = [{ status: "modified" as const, path: "input.txt" }];
  assert.deepEqual(
    (await runRule({ fixture, rule, mode: "changed", changes })).changes,
    changes,
  );
  assert.deepEqual(
    (
      await runRule({
        fixture,
        rule,
        mode: "changed",
        changedProvider: fixture.changedProvider(changes),
      })
    ).changes,
    changes,
  );
  assert.throws(
    () =>
      runRule({
        fixture,
        rule,
        changes,
        changedProvider: fixture.changedProvider([]),
      }),
    /either changes or changedProvider/,
  );
});

test("staged runs automatically read real Git changes and index contents for partially staged files", async (t) => {
  const fixture = await createFixture({ "input.txt": "staged input" });
  t.after(() => fixture.cleanup());
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: fixture.root });
  await exec("git", ["add", "input.txt"], { cwd: fixture.root });
  await fixture.write("input.txt", "ok");
  const result = await runRule({
    fixture,
    rule,
    staged: true,
    options: { limit: 3 },
  });
  assert.equal(result.mode, "changed");
  assert.deepEqual(
    result.changes.map((change) => change.path),
    ["input.txt"],
  );
  assertDiagnostic(result.diagnostics[0], {
    metadata: { content: "staged input" },
  });
  assert.deepEqual(
    (await runRule({ fixture, rule, options: { limit: 3 } })).diagnostics,
    [],
  );
});

test("custom filesystem and generated artifact registrations pass through to the core runner", async (t) => {
  const fixture = await createFixture({ "input.txt": "12345" });
  t.after(() => fixture.cleanup());
  const other = await createFixture({ "input.txt": "short" });
  t.after(() => other.cleanup());
  const result = await runRule({
    fixture,
    rule,
    fs: other.fs,
    options: { limit: 3 },
  });
  assertDiagnostic(result.diagnostics[0], { metadata: { content: "short" } });
  const generated = await runRule({
    fixture,
    rule,
    options: { limit: 3 },
    generatedArtifacts: [{ id: "test/inputs", files: ["input.txt"] }],
  });
  assert.deepEqual(generated.diagnostics, []);
});

test("process mocks and reusable cache stores support repeated rule executions", async (t) => {
  const fixture = await createFixture({});
  t.after(() => fixture.cleanup());
  const cacheStore = new JsonFileRuleCacheStore(fixture.path(".local/cache"));
  const cached: Rule = {
    ...rule,
    async check(context) {
      const count = ((await context.cache.get<number>("count")) ?? 0) + 1;
      await context.cache.set("count", count);
      const process = await context.process.exec({
        command: "custom-tool",
        args: [],
        cwd: context.root,
      });
      return [
        {
          ruleId: rule.metadata.id,
          severity: context.severity,
          scope: "repo",
          message: `${process.stdout}: ${count}`,
        },
      ];
    },
  };
  let calls = 0;
  const process = {
    async exec() {
      calls++;
      return { exitCode: 0, stdout: "mock", stderr: "" };
    },
  };
  assertDiagnostic(
    (await runRule({ fixture, rule: cached, process, cacheStore }))
      .diagnostics[0],
    { message: "mock: 1" },
  );
  assertDiagnostic(
    (await runRule({ fixture, rule: cached, process, cacheStore }))
      .diagnostics[0],
    { message: "mock: 2" },
  );
  assert.equal(calls, 2);
});

test("diagnostic assertions support all fields, useful mismatches, and reusable regular expressions", () => {
  const diagnostic: Diagnostic = {
    ruleId: "custom/rule",
    severity: "error",
    scope: "file",
    path: "input.txt",
    message: "bad input",
    line: 2,
    column: 3,
    endLine: 2,
    endColumn: 8,
    metadata: { detail: [1, 2] },
  };
  const expression = /bad/g;
  assertDiagnostic(diagnostic, {
    message: expression,
    line: 2,
    metadata: { detail: [1, 2] },
  });
  assertDiagnostic(diagnostic, { message: expression });
  assert.equal(expression.lastIndex, 0);
  assert.throws(
    () => assertDiagnostic(diagnostic, { line: 1 }),
    /Diagnostic line mismatch/,
  );
  assert.throws(() => assertDiagnostic(undefined, {}), /Expected diagnostic/);
});

test("fixture paths stay within the temporary project", async (t) => {
  const fixture = await createFixture({ "nested/file.txt": "one" });
  t.after(() => fixture.cleanup());
  assert.equal(await fixture.read("nested/file.txt"), "one");
  await fixture.write("nested/file.txt", "two");
  assert.equal(await fixture.read("nested/file.txt"), "two");
  for (const path of ["../outside.txt", "/absolute.txt", "C:\\outside.txt"]) {
    assert.throws(() => fixture.path(path), /must stay inside/);
    await assert.rejects(fixture.write(path, "bad"), /must stay inside/);
  }
  await assert.rejects(
    createFixture({ "../outside.txt": "bad" }),
    /must stay inside/,
  );
});

test("directory fixtures exclude exact output directories while retaining similarly named files", async (t) => {
  const source = await createFixture({
    "dist/generated.js": "output",
    "node_modules/tool/index.js": "tool",
    "distribution/input.txt": "keep",
    "distance.txt": "keep",
  });
  t.after(() => source.cleanup());
  // <!-- qg-suppress-next-line test/no-directory-fixture-copy: exercise the copying helper itself -->
  const fixture = await createFixtureFromDirectory(
    pathToFileURL(`${source.root}/`),
  );
  t.after(() => fixture.cleanup());
  assert.equal(await fixture.fs.exists("dist"), false);
  assert.equal(await fixture.fs.exists("node_modules"), false);
  assert.equal(await fixture.read("distribution/input.txt"), "keep");
  assert.equal(await fixture.read("distance.txt"), "keep");
});
