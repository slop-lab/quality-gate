import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixture, runRule } from "@slop-lab/qg-rule-test-utils";
import { noTrackedLocalFilesRule } from "./tracked-local.js";

test("reports tracked files in any .local directory", async (t) => {
  const fixture = await createFixture({});
  t.after(() => fixture.cleanup());
  const result = await runRule({
    fixture,
    rule: noTrackedLocalFilesRule,
    process: {
      async exec() {
        return {
          exitCode: 0,
          stdout: ".local/token\0apps/x/.local/state\0src/index.ts\0",
          stderr: "",
        };
      },
    },
  });
  assert.deepEqual(
    result.diagnostics.map((item) => item.path),
    [".local/token", "apps/x/.local/state"],
  );
});
