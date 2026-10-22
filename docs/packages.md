# Package boundaries

The repository publishes thirteen packages with the same release version.
Package boundaries follow coherent development domains, integrations and public
library roles. Individual rules and selections share their domain package.

| Package | Responsibility | Runtime dependencies |
| --- | --- | --- |
| `qg-core` | Rule runner, snapshots, providers and configuration types | Node.js only |
| `qg-check-runner` | Command/Node check execution and concise test reporter | core |
| `qg-rule-testing` | Fixtures and assertions for rule authors | core |
| `qg-stdin-adapter` | Snapshot stdin rule factory and command caching | core |
| `qg-rules-git` | Git hygiene policies | core |
| `qg-rules-files` | File layout, content/directory limits and Markdown policies | core, Markdown parser |
| `qg-rules-js` | JS/TS directives, fixture practices, package manifests and pnpm integrity | core, TypeScript parser |
| `qg-rules-biome` | Biome stdin format adapter | core, stdin-adapter |
| `qg-rules-prettier` | Prettier stdin check adapter | core, stdin-adapter |
| `qg-rules-eslint` | ESLint stdin JSON adapter | core, stdin-adapter |
| `qg-rules-cspell` | Spelling and project dictionaries | core, CSpell library |
| `qg-rules-recommended` | Default Git/file policy composition | core, git/files rules |
| `qg` | CLI configuration, hooks, daemon, rendering and exit status | core, check-runner, recommended, YAML parser |

Public names use `@slop-lab/`. The private root is `@this-project/qg-repo` and
is never published. Local-only workspaces use `@this-project/...`.

## Selecting policies

```yaml
presets: [js]
ruleModules:
  - "@slop-lab/qg-rules-biome"
  - "@slop-lab/qg-rules-cspell"
rules:
  external/biome: error
  external/cspell: error
```

The default CLI graph contains Git/file policies, including Markdown, without
the JS/TS package, TypeScript parser or CSpell. The optional `qg-rules-js`
package groups source directives, test fixtures, package manifests and pnpm
integrity. The `js` preset loads its collection; focused `js-directives` and
`js-test-fixtures` presets select subsets from that same installed package.
Per-rule settings control enablement, severity and options.

`qg-rules-files` groups layout, limits and Markdown policies. It exposes
individual rules and `layoutRules`, `fileLimitRules`, `markdownRules` collections
for library callers. The recommended set keeps its existing rule order and
default behavior. Core's generic custom-path helper has no parser dependency.

Each external tool adapter owns its protocol and diagnostics. Shared snapshot
stdin execution lives in `qg-stdin-adapter`, without a tool registry. Tool binaries
are supplied by the consuming project. These integrations remain separate from
the JS source/manifest/fixture policy collection.

`qg-check-runner` contains command/test execution and the Node reporter. It exposes
`runChecks`, `createNodeTestCommand` and the `node-test-reporter` subpath without
a CLI dependency. See the [checks API](checks-api.md). `qg-rule-testing`
provides fixtures/assertions for rule authors, independently of check execution.

Repository-only policies use the same public provider and helper interfaces
through `scripts/qg-rules.mjs`; they are not built into core or the CLI.

Rule collections use `qg-rules-*`. Support libraries name their role explicitly:
`qg-stdin-adapter` builds command-backed rules, `qg-rule-testing` supplies rule
fixtures/assertions, and `qg-check-runner` executes shared command/test checks.
These names do not change the top-level `checks` configuration or rule IDs.
