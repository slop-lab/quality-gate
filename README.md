# Quality Gate

Quality Gate is a policy runner for code quality checks that can focus on Git changes while still supporting full repository scans for scheduled validation.

The project is intended for AI-assisted implementation workflows where fast, deterministic feedback on the current change set is more useful than running every heavyweight tool all the time. It should also work as a regular CLI and as a long-running workspace server with persistent caches.

## Goals

- Prefer changed-scope checks for interactive development.
- Support full scans for CI, scheduled jobs, and baseline creation.
- Provide one runner model for CLI, server, and future MCP-style integrations.
- Let projects tune built-in rules and add custom rules without forking the runner.
- Keep rules deterministic, explainable, and scoped to declared inputs.
- Support monorepos with package-aware configuration and cache isolation.

## Current Runtime

The implementation is TypeScript. The runtime includes:

- `@slop-lab/qg-core`: runner, Git change parsing, injectable input providers, and rule cache storage.
- `@slop-lab/qg-rules-git`: Git hygiene checks, including `gitkeep/no-lone-gitkeep`.
- `@slop-lab/qg-rules-files`: required root and companion files, filename/path policies, file limits, document references, Markdown character policies, and suppression-reason checks.
- `@slop-lab/qg-rules-js`: JavaScript type-checking, package manager consistency, and opt-in external formatter/linter checks.
- `@slop-lab/qg-rules-test`: test fixture checks.
- `@slop-lab/qg-rules-cspell`: optional spelling checks with project dictionaries.
- `@slop-lab/qg-test-utils`: fixtures, rule execution, and assertions for custom rule tests.
- `@slop-lab/qg-rules-recommended`: the language-independent default Git and file rule set.
- `@slop-lab/qg`: the `qg` CLI for `check`, `run-hook`, `hooks install`, `rules`, `daemon`, and `cache clear --rule`.

The CLI defaults to staged changes and index contents. Use `check --full` for
a repository-wide working tree scan. See [CLI](docs/cli.md) for configuration
and supported options; the architecture document also describes future work.

## Documents

- [Architecture](docs/architecture.md)
- [Plugin Contract](docs/plugin-contract.md)
- [CLI](docs/cli.md)
- [Publishing](docs/publishing.md)
- [External tools](docs/external-tools.md)
- [Required files and nearby-file detection](docs/file-policies.md)
- [File length and generated artifacts](docs/generated-artifacts.md)
- [Directory file limits and self-only configuration](docs/directory-limits.md)

## Use in another project

The CLI package is designed to be installed as a project-local development
dependency. Once a version is available in your registry:

```sh
pnpm add -D @slop-lab/qg
pnpm exec qg check
pnpm exec qg hooks install
```

For package scripts, call the local binary directly:

```json
{
  "scripts": {
    "quality": "qg check",
    "quality:full": "qg check --full"
  },
  "devDependencies": {
    "@slop-lab/qg": "<version>"
  }
}
```

The CLI declares core, the recommended Git/file rule set, and YAML parsing as
runtime dependencies. Your package manager installs these automatically. Core has no
dependency on the CLI or rule packages and can be embedded with custom rules.

JavaScript and TypeScript rules are separate opt-in packages:

```sh
npm install --save-dev @slop-lab/qg-rules-js @slop-lab/qg-rules-test
```

```yaml
presets: [js, test]
```

CSpell is available separately through `@slop-lab/qg-rules-cspell`. Load it with
`ruleModules: ["@slop-lab/qg-rules-cspell"]` and enable `external/cspell`.
See the [CSpell plugin guide](packages/rules-cspell/README.md) for settings.

Filename and path policies can use regular-expression allowlists or rules written
in code. Load custom rule modules with `ruleModules: ["./qg-rules.mjs"]`; the
`createFilePathRule` helper handles changed/full scans and per-file settings.
See [file names and custom path policies](docs/file-paths.md). Public
`RuleProvider`/`RuleExecutor` types in `@slop-lab/qg-core` also support custom
execution through subprocesses or daemons; see [rule providers](docs/rule-providers.md).

Install only the packages your project needs. The default CLI installation does
not include either package. `qg rules` lists the rules selected for the project.

`qg` and `qg check` run rules followed by the shared command and Node.js test
checks configured under top-level `checks` in `.qg.yaml`. Use `--rules-only` for
just the rules. The installed hook runs staged rules and those same shared checks.
Run `pnpm exec qg run-hook pre-commit` to
reproduce it manually. See [pre-commit setup](docs/cli.md#run-hook-pre-commit-and-hooks-install)
to migrate formatter, typecheck, and test checks from existing hooks. Use
`type: node-test` with `files: ["test/**/*.test.mjs"]` to run Node tests directly
with concise failure diagnostics.

To run an unpublished checkout:

```sh
mise install
mise exec -- just bootstrap
mise exec -- just qg rules
```

Requires Node.js 24 or later. Create `.qg.yaml` in the target project
to configure rules, and add `.local/` to its `.gitignore` if using the daemon.

## Development

Install dependencies and run the TypeScript build:

```sh
mise install
mise exec -- just bootstrap
```

Run tests after building:

```sh
mise exec -- just test
```

`just bootstrap` also installs the QG pre-commit hook for this clone. For an
existing checkout, run `just qg hooks install`. The repository enables staged Biome formatting through
QG and runs full Biome checks, the build, TypeScript checks, and tests through
top-level `checks`.
Use `just qg run-hook pre-commit` to run the complete hook manually,
`just qg check --full` or `just ci` for full rules and shared checks.
Use `just qg check --full --rules-only` for a full rule scan alone.
Full Biome lint/assist checks run through the shared command checks; the
staged Biome rule checks formatting. `just ci` uses those same QG commands,
including the shared build/test steps, instead of separate lint/check aliases.

`just qg ...` builds before running the CLI. Successful builds are silent;
failed builds display the compiler/bundler output and stop the command.
`just build`, `just test`, and `just format` remain available for focused work.
Successful checks and test runs print `PASS`; setup and formatting print `OK`.
Passing test names, test totals, and successful command logs are omitted by
default. Failures retain diagnostics and command output. Help, rule listings,
daemon status, and explicit JSON requests keep their requested results.

Run the checkout's CLI with `mise exec -- just qg rules`.

TypeScript checks and compiles the tests; tsdown builds package entrypoints and
type declarations. `tsdown.config.ts` discovers workspace packages and uses
each package's `src/index.ts` as its public entrypoint, plus the CLI's test reporter. The `exports`, `main`,
`module`, and `types` fields in package manifests are generated by the build;
change the build entrypoints rather than editing those fields by hand.
Package imports remain external to the build. Publish core first, then the
individual rule packages, then `@slop-lab/qg-rules-recommended`, and finally
`@slop-lab/qg`. Test utilities can be published after core. Testing unpublished
tarballs in another project requires installing all workspace dependency
tarballs together; the CLI tarball alone needs those versions in the registry.

## Publishing

Packages use version `0.1.0`, require Node.js 24 or later, and are licensed
under MIT. Internal dependency versions use ordinary npm semver; pnpm links
matching packages locally through `pnpm-workspace.yaml`.

For a fresh machine, authentication, package previews, exact publish order, and
post-publish installation checks, follow the [publishing runbook](docs/publishing.md).

```sh
mise exec -- just release-check
```

This runs CI and `npm pack --dry-run` for all nine public packages, including
their prepack builds. It does not publish. Public access is set in each package's
`publishConfig`; only the workspace root is private.
