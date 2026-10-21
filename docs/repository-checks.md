# Repository checks

This repository consumes its published interfaces through root `.qg.yaml`.
`qg` and `qg check` run rules followed by shared command/test checks.
The pre-commit hook selects index contents for rules and runs the same shared
checks. `just ci` checks the complete working tree. Build and external command
checks use the working tree; staged rules use the index snapshot.

| Component | Repository use |
| --- | --- |
| Recommended rules | Git hygiene, file/directory limits, Markdown characters, suppression reasons, root requirements and local documentation links. |
| `presets: [js, js-test]` | pnpm integrity, JavaScript type-check directives, package names and syntax-aware fixture checks. |
| CSpell rule module | Spelling in documentation, source and repository scripts using project dictionaries. |
| Filename/path rules | Kebab-case source names and TypeScript source under package `src` directories, matching the build layout. |
| Companion requirements | Every workspace package includes its README, license and TypeScript project. |
| Local rule provider | Package names follow directory names; version, license and Node.js engines match the root release; internal dependencies use publishable versions. |
| Shared checks API | `@slop-lab/qg-checks` runs command/Node checks and ships the reusable test reporter, independently of CLI rendering. |
| Shared command checks | Complete Biome validation and package builds/type checks. |
| Built-in Node test check | Compiled package tests and repository script tests, with concise failure output. |

## Project-specific policy through a public interface

`scripts/qg-rules.mjs` exports `ruleProvider` using `createRuleProvider` from
`@slop-lab/qg-core`, including its dependency-free `createFilePathRule` helper.
The CLI loads it through `ruleModules`; it has no repository-specific execution
path. The policy reads manifests through the injected filesystem, including
index snapshots during pre-commit. A shared root `package.json` change triggers
revalidation of all package manifests through `recheckOnChanges`.

The provider is tested next to its implementation in `scripts/qg-rules.test.mjs`
using the public `@slop-lab/qg-test-utils` fixture and rule helpers. Both
`just test` and QG's Node test check include these source tests.
`tsconfig.scripts.json` also checks the repository scripts and build configuration
as part of the regular TypeScript build.

## Spelling policy

`cspell.json` contains reviewed project terminology. Narrow file overrides cover
Unicode script identifiers and intentional invalid fixture words. Test files
remain checked; neither tests nor source strings are broadly excluded. New
ordinary misspellings should be fixed rather than added to the dictionary.
CSpell's own configuration and dictionaries are loaded from the working tree.

## Tool selection

Biome is the repository's formatter and linter, loaded through the independent
`@slop-lab/qg-rules-biome` module. The stdin rule checks the
staged snapshot; the shared `biome check` command performs complete working-tree
validation. Prettier and ESLint adapters remain available to projects using
those tools. This repository does not install redundant formatter/linter tools.
External daemon execution remains optional; normal local rules use the same
provider interface without requiring an extra service.

## Development commands

```sh
just qg
just qg check --full
just qg check --full --rules-only
just qg run-hook pre-commit
just test
just release-check
```

`just qg` builds the CLI before running it. Full checks validate untouched
files too. Package previews include all fourteen public packages. Successful checks
print `PASS`, while failures retain their detailed diagnostics.
