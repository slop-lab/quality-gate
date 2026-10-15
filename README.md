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

## Initial Scope

The first implementation will be TypeScript. The repository may later contain other implementations, such as Go, but the core behavior should be documented as a language-neutral contract.

The first rule package will cover Git-oriented hygiene checks, starting with:

- `gitkeep/no-lone-gitkeep`: report an error when a directory contains no files except `.gitkeep`.

## Documents

- [Architecture](docs/architecture.md)
- [Plugin Contract](docs/plugin-contract.md)
- [CLI](docs/cli.md)

## Use in another project

Install Quality Gate as a project-local development dependency:

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

The published CLI artifact is bundled, so consumers do not need to install the
repository's internal workspace packages separately.

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

The initial runtime includes:

- `@quality-gate/core`: runner, Git change parsing, injectable changed provider, filesystem adapter.
- `@quality-gate/rules-git`: Git hygiene rules, starting with `gitkeep/no-lone-gitkeep`.
- `quality-gate`: minimal CLI for `check` and `rules`.
