# QG Test Rules

`@slop-lab/qg-rules-test` provides QG checks for test fixture practices,
including `test/no-directory-fixture-copy`.
Requires Node.js 24 or later. Licensed under MIT.

This package is independent of `@slop-lab/qg-rules-recommended`. Install it
with `npm install --save-dev @slop-lab/qg-rules-test` and select `presets: [test]`
in the root `.qg.yaml`. Library callers can compose its `testRules` export with
other rules.
See the [CLI documentation](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for rule configuration and staged scans.
