# @slop-lab/qg-rules-js

JavaScript/TypeScript development policies in one optional package. It includes
source directives, test fixture practices, package.json names and pnpm integrity.
Requires Node.js 24 or later. The TypeScript parser is a runtime dependency for
syntax-aware fixture checks. The package does not install pnpm or external tools.

```sh
npm install --save-dev @slop-lab/qg-rules-js
```

```yaml
presets: [js]
rules:
  package/allowed-name:
    severity: error
    options:
      allowedPatterns: ["@my-org/[^/]+", "@this-project/[^/]+"]
  test/no-directory-fixture-copy: error
```

The `js` preset loads the whole rule collection. Individual rules retain their
defaults: package naming is opt-in, the fixture rule defaults to warning, and
pnpm checks require pnpm workspace inputs. Configure each rule's severity/options
or turn it off through normal QG configuration.

Focused `js-directives` and `js-test-fixtures` presets select subsets from this
same package. They require no additional packages. Overlapping preset selections
load each rule once. Alternatively, add `@slop-lab/qg-rules-js` to `ruleModules`.

| Rule | Responsibility |
| --- | --- |
| `js/require-ts-check` | Require an effective leading `// @ts-check` in JS source. |
| `test/no-directory-fixture-copy` | Detect test code copying fixture directories using JS/TS syntax analysis. |
| `package/allowed-name` | Restrict entire package.json names using regular-expression allowlists. |
| `package-manager/no-npm-lock-with-pnpm` | Reject npm lockfiles in pnpm workspaces. |
| `pnpm/lockfile-is-current` | Check that pnpm would leave the lockfile unchanged. |

Library callers can import individual rules, `jsRules`/`rules` (the full collection),
`jsDirectiveRules`, `jsTestFixtureRules`, `packageJsonRules`, `packageManagerRules`,
and `presets`. Core does not load any of these automatically.

Staged scans use the injected index snapshot. pnpm lockfile validation constructs
an isolated workspace from that snapshot, disables install scripts and removes
the temporary workspace afterward. Fixture checks use a TypeScript AST so code
samples and comments do not count as calls; import aliases and namespaces work.

The CLI's language-independent recommended set has no runtime dependency on this
package or its parser. Biome, Prettier, ESLint and CSpell adapters remain separate
integrations. Rule IDs and regular path overrides, generated-artifact settings
and recovery messages are unchanged.
