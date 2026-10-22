# Package boundaries

The repository publishes nineteen packages with the same release version.
Responsibilities and runtime dependencies follow execution and installation
needs rather than individual rule count.

| Package | Responsibility | Runtime dependencies |
| --- | --- | --- |
| `qg-core` | Rule execution, snapshots, providers and configuration types | Node.js only |
| `qg-rule-test-utils` | Fixtures and assertions for rule authors | core |
| `qg-check-node-test` | Node test command preparation and concise reporter | core |
| `qg-check-runner` | Sequential command/test execution and failure diagnostics | core, check-node-test |
| `qg-rule-stdin` | Snapshot stdin rule factory and command result caching | core |
| `qg-rules-git` | Git hygiene policies | core |
| `qg-rules-file-layout` | Allowed names/paths, required root and companion files | core |
| `qg-rules-file-limits` | Bytes, lines, line length and file counts per directory | core |
| `qg-rules-markdown` | Markdown references, characters and suppression reasons | core, Markdown parser |
| `qg-rules-js-directives` | Effective JavaScript type-check directives | core |
| `qg-rules-package-json` | package.json name policies | core |
| `qg-rules-pnpm` | pnpm workspace and lockfile integrity | core |
| `qg-rules-js-test-fixtures` | JS/TS test fixture construction policies | core, TypeScript parser |
| `qg-rules-biome` | Biome stdin format arguments and diagnostics | core, rule-stdin |
| `qg-rules-prettier` | Prettier stdin check arguments and diagnostics | core, rule-stdin |
| `qg-rules-eslint` | ESLint stdin JSON arguments and diagnostics | core, rule-stdin |
| `qg-rules-cspell` | Spelling and project dictionaries | core, CSpell library |
| `qg-rules-recommended` | Default Git/layout/limits/Markdown composition | core, git/layout/limits/Markdown rules |
| `qg` | CLI configuration, hooks, daemon, rendering and exit status | core, check-runner, recommended, YAML parser |

Package names above use the `@slop-lab/` scope. The default CLI dependency graph
excludes JS rules, TypeScript parser and CSpell. The generic core file-policy
helper does not depend on Markdown parsing. Repository-only release rules live
in `scripts/qg-rules.mjs` and consume the same public APIs as external projects.

## Selecting optional behavior

```yaml
presets: [js-directives, js-test-fixtures]
ruleModules:
  - "@slop-lab/qg-rules-biome"
  - "@slop-lab/qg-rules-cspell"
rules:
  external/biome: error
  external/cspell: error
```

Each tool adapter is a separately installed package with its own protocol
implementation and tests. Only snapshot stdin execution is shared through
`qg-rule-stdin`; it has no tool registry or tool-specific branches. New tool
adapters belong in their own packages. Their executables are resolved from the
consuming project or configured explicitly; selecting an adapter does not
install its tool. JS/TS fixture checks use an explicit `js-test-fixtures` preset so their
parser dependency is clear. Rule IDs remain stable across package moves.

The check runner returns diagnostics and the CLI renders them. Library callers
can reuse the runner independently; see [checks API](checks-api.md).
The reporter belongs to `qg-check-node-test` and is exposed through its own
package entry point. No code depends on a private CLI filesystem location.

The private repository root is `@this-project/qg-repo`. It is never published.
Public packages use `@slop-lab/qg` or `@slop-lab/qg-*`; local-only workspaces
use `@this-project/...`.

## Explicit composition

JavaScript directive and test-fixture presets are `js-directives` and
`js-test-fixtures`. Neither loads manifest or package-manager policies. Load
`@slop-lab/qg-rules-package-json` and `@slop-lab/qg-rules-pnpm` through
`ruleModules` when those policies apply. Default recommendations continue to
compose Git, file layout, file limits and Markdown rules in the same order.

`qg-check-runner` runs shared command/test lists; `qg-check-node-test` owns the
Node-specific command and reporter. `qg-rule-test-utils` provides fixtures and
assertions for rule authors; it does not provide a general Node test runner.

Before the initial publish, the old checks/files/JS aggregate package names and
generic JS/test preset names were replaced with these names. No compatibility
packages are published. Rule IDs and `checks` configuration remain unchanged.
