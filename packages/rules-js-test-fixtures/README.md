# QG JavaScript/TypeScript Test Rules

`@slop-lab/qg-rules-js-test-fixtures` provides QG checks for JS/TS test fixture practices,
including `test/no-directory-fixture-copy`.
Requires Node.js 24 or later. Licensed under MIT.

This package is independent of `@slop-lab/qg-rules-recommended`. Install it
with `npm install --save-dev @slop-lab/qg-rules-js-test-fixtures` and select `presets: [js-test-fixtures]`
in the root `.qg.yaml`. Library callers can compose its `jsTestFixtureRules` export with
other rules.
See the [CLI documentation](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for rule configuration and staged scans.

Fixture copy detection parses TypeScript/TSX syntax, so code samples, strings
and comments do not count as calls. Named import aliases and namespace calls
are supported. Template expressions containing real calls remain checked.
The package depends on the TypeScript parser for this syntax analysis.
