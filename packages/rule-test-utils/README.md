# QG Test Utilities

`@slop-lab/qg-rule-test-utils` provides fixtures, rule execution, and diagnostic
assertions for testing custom QG rules. Requires Node.js 24 or later. MIT licensed.
It depends only on `@slop-lab/qg-core`, with no CLI or recommended rule dependency.

```sh
npm install --save-dev @slop-lab/qg-core @slop-lab/qg-rule-test-utils
```

Use your own rule with Node's test runner or another async test framework:

```ts
import { test } from "node:test";
import { assertDiagnostic, createFixture, runRule } from "@slop-lab/qg-rule-test-utils";
import { limitRule } from "./limit-rule.js"; // Your Rule<{ limit: number }>

test("reports long input", async (t) => {
  const fixture = await createFixture({ "input.txt": "too long" });
  t.after(() => fixture.cleanup());

  const result = await runRule({
    fixture,
    rule: limitRule,
    options: { limit: 3 },
    severity: "warning",
  });
  assertDiagnostic(result.diagnostics[0], {
    ruleId: limitRule.metadata.id,
    severity: "warning",
    path: "input.txt",
    message: /limit/,
  });
});
```

## Rule configuration

`options` is typed as `Partial<TOptions>` from the supplied `Rule<TOptions>`.
`severity` accepts `error`, `warning`, `info`, or `off`. Both are optional.
Use `config` for full QG configuration, including rule settings, custom messages,
path overrides, and generated artifact policies:

```ts
const result = await runRule({
  fixture,
  rule: limitRule,
  options: { limit: 3 },
  config: {
    overrides: [
      { files: ["vendor/**"], rules: { [limitRule.metadata.id]: "off" } },
    ],
  },
});
```

Precedence is rule defaults, root `config.rules`, shorthand `options`/`severity`,
then matching `config.overrides`. Options merge shallowly. An options-only
shorthand preserves disabled state and custom messages. Set `severity` to enable
a rule disabled by default. The helper does not mutate the rule or configuration.

`runRule` defaults to a full scan. In changed mode, pass `changes` to inject
synthetic change entries without initializing Git:

```ts
await runRule({
  fixture,
  rule: limitRule,
  mode: "changed",
  changes: [{ status: "modified", path: "input.txt" }],
});
```

`staged: true`, `workingTree: true`, or explicit `base`/`head` selections default
to changed mode and use real Git changes when `changes` is omitted. Initialize
Git and stage files in the fixture before a staged test. Staged runs read index
contents, including partial staging; they do not use the working-tree fixture
filesystem unless you explicitly supply `fs`.

Advanced inputs pass through to the core runner: `process`, `cacheStore`, `fs`,
`changedProvider`, `generatedArtifacts`, and Git scan flags. Reuse a `cacheStore`
across runs to test caching. Pass either `changes` or `changedProvider`, not both.
CLI presets, YAML loading, and hook setup are outside this helper's scope.

## Diagnostic assertions

`assertDiagnostic(actual, expected)` compares only the fields you provide.
It supports all diagnostic fields, including start/end locations, metadata,
suggested fixes, and suppression flags. Selected fields use deep equality.
`message` accepts either a string or a `RegExp`; regex assertions do not mutate
the supplied expression. Missing diagnostics and mismatched fields throw with
an assertion message and difference details.

## Fixtures

`createFixture(files)` creates a temporary project from a path/content map.
Fixtures expose `root`, `fs`, `path`, `read`, `write`, `changedProvider`, and
`cleanup`. Always register cleanup with your test framework. Paths must stay
inside the fixture root and use `/` separators. Filesystem writes create missing
parent directories.

`createFixtureFromDirectory(pathOrUrl)` copies a fixture tree for integration
tests. It excludes exact `node_modules` and `dist` directory segments and retains
similarly named files or directories such as `distance.txt` and `distribution`.
