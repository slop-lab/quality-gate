import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesAnyGlob } from "./config.js";

test("glob matching covers newline filenames and requires a complete path match", () => {
  assert.equal(matchesAnyGlob("src/line\nbreak.ts", ["**"]), true);
  assert.equal(matchesAnyGlob("src/line\nbreak.ts", ["src/**"]), true);
  assert.equal(matchesAnyGlob("src/line\nbreak.ts", ["**/*.ts"]), true);
  assert.equal(matchesAnyGlob("line\nbreak/file.ts", ["**/file.ts"]), true);
  assert.equal(matchesAnyGlob("file.ts\n", ["file.ts"]), false);
  assert.equal(matchesAnyGlob("src/file.ts\n", ["**/*.ts"]), false);
  assert.equal(matchesAnyGlob("src/file.ts", ["src/*.ts"]), true);
});
