import assert from "node:assert/strict";
import { test } from "node:test";
import { runQualityGate } from "@slop-lab/qg-core";
import { createFixture } from "@slop-lab/qg-rule-testing";
import { recommendedRules } from "./index.js";

for (const mode of ["full", "changed"] as const) {
  test(`recommended rules run through core in ${mode} mode with project configuration`, async (t) => {
    const fixture = await createFixture({
      "README.md": "# Fixture\n",
      ".gitattributes": "* text=auto eol=lf\n",
      "empty/.gitkeep": "",
      "oversized.txt": "12345",
    });
    t.after(() => fixture.cleanup());
    const result = await runQualityGate({
      root: fixture.root,
      mode,
      rules: recommendedRules,
      fs: fixture.fs,
      changedProvider: fixture.changedProvider([
        { status: "added", path: "empty/.gitkeep" },
        { status: "added", path: "oversized.txt" },
      ]),
      process: {
        async exec() {
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      config: {
        rules: {
          "files/max-bytes": [
            "warning",
            { limit: 4, ignoredPaths: ["README.md", ".gitattributes"] },
          ],
        },
      },
    });
    assert.deepEqual(
      result.diagnostics.map(({ ruleId, path, severity }) => ({
        ruleId,
        path,
        severity,
      })),
      [
        {
          ruleId: "gitkeep/no-lone-gitkeep",
          path: "empty/.gitkeep",
          severity: "error",
        },
        {
          ruleId: "files/max-bytes",
          path: "oversized.txt",
          severity: "warning",
        },
      ],
    );
  });
}
