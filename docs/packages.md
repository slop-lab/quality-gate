# Package boundaries

The repository publishes fourteen packages with the same release version.
Responsibilities and runtime dependencies follow execution and installation
needs rather than individual rule count.

| Package | Responsibility | Runtime dependencies |
| --- | --- | --- |
| `qg-core` | Rule runner, provider interfaces, snapshots, configuration types, file-policy helpers | Node.js only |
| `qg-checks` | Command/Node check runner and test reporter | core |
| `qg-test-utils` | Fixtures and assertions for custom rule authors | core |
| `qg-rules-git` | Git hygiene | core |
| `qg-rules-files` | Files, directories and document policies | core, Markdown parser |
| `qg-rules-js` | JS directives, package names and package-manager integrity | core |
| `qg-rules-js-test` | JS/TS test fixture policy | core, TypeScript parser |
| `qg-rule-stdin` | Snapshot stdin rule factory, command discovery and caching | core |
| `qg-rules-biome` | Biome format stdin protocol and diagnostics | core, rule-stdin |
| `qg-rules-prettier` | Prettier check stdin protocol and diagnostics | core, rule-stdin |
| `qg-rules-eslint` | ESLint JSON stdin protocol and diagnostics | core, rule-stdin |
| `qg-rules-cspell` | Spelling and dictionaries | core, CSpell library |
| `qg-rules-recommended` | Default language-independent composition | core, git/files rules |
| `qg` | Config/module loading, hooks, daemon, output and exit status | core, checks, recommended, YAML parser |

Package names above use the `@slop-lab/` scope. The default CLI dependency graph
excludes JS rules, TypeScript parser and CSpell. The generic core file-policy
helper does not depend on Markdown parsing. Repository-only release rules live
in `scripts/qg-rules.mjs` and consume the same public APIs as external projects.

## Selecting optional behavior

```yaml
presets: [js, js-test]
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
install its tool. JS/TS fixture checks use an explicit `js-test` preset so their
parser dependency is clear. Rule IDs remain stable across package moves.

The check runner returns diagnostics and the CLI renders them. Library callers
can reuse the runner independently; see [checks API](checks-api.md).
The reporter belongs to the checks package and is exposed through its own
package entry point. No code depends on a private CLI filesystem location.

The private repository root is `@this-project/qg-repo`. It is never published.
Public packages use `@slop-lab/qg` or `@slop-lab/qg-*`; local-only workspaces
use `@this-project/...`.
