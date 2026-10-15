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

- `@quality-gate/core`: runner, Git change parsing, injectable input providers, and rule cache storage.
- `@quality-gate/rules-git`: Git hygiene checks, including `gitkeep/no-lone-gitkeep`.
- `@quality-gate/rules-files`: file limits and document reference checks.
- `@quality-gate/rules-package-manager`: package manager consistency checks.
- `@quality-gate/rules-test`: test fixture checks.
- `quality-gate`: CLI for `check`, `rules`, `daemon`, and `cache clear --rule`.

The CLI defaults to staged changes and index contents. Use `check --full` for
a repository-wide working tree scan. See [CLI](docs/cli.md) for configuration
and supported options; the architecture document also describes future work.

## Documents

- [Architecture](docs/architecture.md)
- [Plugin Contract](docs/plugin-contract.md)
- [CLI](docs/cli.md)

## Use in another project

The CLI package is designed to be installed as a project-local development
dependency. Once a version is available in your registry:

```sh
pnpm add -D quality-gate
pnpm exec quality-gate check
```

For package scripts, call the local binary directly:

```json
{
  "scripts": {
    "quality": "quality-gate check",
    "quality:full": "quality-gate check --full"
  },
  "devDependencies": {
    "quality-gate": "<version>"
  }
}
```

The CLI package artifact is bundled, so consumers do not need to install the
repository's internal workspace packages separately.

To use an unpublished checkout, build and pack it, then install the generated
tarball in the target project:

```sh
mise install
mise exec -- just bootstrap
mise exec -- pnpm --dir packages/cli pack
```

```sh
# From the target project; use the tarball path printed by pnpm pack.
pnpm add -D /path/to/quality-gate/packages/cli/quality-gate-0.0.0.tgz
pnpm exec quality-gate rules
```

Requires Node.js 22 or later. Create `.qualitygate.yaml` in the target project
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

Run the checkout's bundled CLI with `mise exec -- just quality-gate rules`.
