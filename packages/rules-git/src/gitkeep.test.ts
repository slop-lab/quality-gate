import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDiagnostic,
  createFixture,
  runRule,
} from "@slop-lab/qg-test-utils";
import { collectAffectedDirectories, noLoneGitkeepRule } from "./gitkeep.js";

test("collectAffectedDirectories includes old and new rename endpoints", () => {
  assert.deepEqual(
    collectAffectedDirectories(["a/old.ts", "b/new.ts", "root.ts"]),
    [".", "a", "b"],
  );
});

test("changed scan reports directories that only contain .gitkeep", async (t) => {
  const fixture = await createFixture({
    "src/.gitkeep": "",
  });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: noLoneGitkeepRule,
    mode: "changed",
    changes: [{ status: "deleted", path: "src/removed.ts" }],
  });

  assert.equal(result.diagnostics.length, 1);
  assertDiagnostic(result.diagnostics[0], {
    ruleId: "gitkeep/no-lone-gitkeep",
    severity: "error",
    path: "src/.gitkeep",
    scope: "directory",
  });
});

test("changed scan ignores directories with real files", async (t) => {
  const fixture = await createFixture({
    "src/.gitkeep": "",
    "src/index.ts": "export {};\n",
  });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: noLoneGitkeepRule,
    mode: "changed",
    changes: [{ status: "modified", path: "src/index.ts" }],
  });

  assert.equal(result.diagnostics.length, 0);
});

test("full scan reports lone .gitkeep directories without changed provider", async (t) => {
  const fixture = await createFixture({
    "src/.gitkeep": "",
  });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: noLoneGitkeepRule,
    mode: "full",
  });

  assert.equal(result.diagnostics.length, 1);
  assertDiagnostic(result.diagnostics[0], {
    ruleId: "gitkeep/no-lone-gitkeep",
    severity: "error",
    path: "src/.gitkeep",
    scope: "directory",
  });
});
