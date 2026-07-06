# CLI

The CLI should expose the same runner behavior used by the server.

Working command name:

```sh
quality-gate
```

## Commands

### `check`

Run a scan and report diagnostics.

```sh
quality-gate check
quality-gate check --changed
quality-gate check --full
quality-gate check --base origin/main
quality-gate check --staged
quality-gate check --working-tree
quality-gate check --format json
quality-gate check --format sarif --output quality-gate.sarif
```

Default mode should be `--changed` for local interactive runs and configurable for CI. If `CI=true`, the default may still be changed mode when a base ref is available, but full mode should be easy to request explicitly.

Important options:

- `--changed`: scan Git affected paths.
- `--full`: scan the full configured repository scope.
- `--base <ref>`: compare against a base ref.
- `--head <ref>`: compare against a head ref.
- `--staged`: inspect staged changes.
- `--working-tree`: include unstaged working tree changes.
- `--paths <glob...>`: restrict scan to paths.
- `--rules <id...>`: run only selected rules.
- `--format <stylish|json|sarif|github>`: select output format.
- `--output <path>`: write report to file.
- `--fix`: apply safe structured fixes.
- `--max-warnings <n>`: fail when warnings exceed a threshold.
- `--config <path>`: use a specific config file.
- `--no-cache`: bypass persistent cache.
- `--explain`: print config and rule activation details.

### `server`

Start a persistent workspace server.

```sh
quality-gate server
quality-gate server --workspace .
quality-gate server --socket .quality-gate/server.sock
quality-gate server --stdio
quality-gate server --cache-dir .quality-gate/cache
```

Server modes:

- `--stdio`: useful for MCP-style process integration.
- `--socket <path>`: useful for editor or agent integrations.
- `--port <port>`: optional HTTP mode for local tools.

The server should support changed and full scans through the same protocol.

Useful server options:

- `--workspace <path>`: initialize a workspace at startup.
- `--workspace-id <id>`: assign a stable ID to the startup workspace.
- `--cache-dir <path>`: choose persistent cache storage.
- `--watch`: maintain incremental filesystem and Git metadata.
- `--no-watch`: validate inputs on demand only.
- `--max-workspaces <n>`: limit registered workspaces.
- `--idle-timeout <duration>`: unload inactive workspace resources.

### `workspace`

Manage workspaces in a running server.

```sh
quality-gate workspace add . --id quality-gate
quality-gate workspace list
quality-gate workspace status quality-gate
quality-gate workspace remove quality-gate
```

The standalone CLI does not require workspace registration. Workspace commands are for persistent server usage where multiple repositories or multiple config/plugin sets may be active.

### `init`

Create an initial config.

```sh
quality-gate init
quality-gate init --preset git
quality-gate init --preset typescript
```

### `rules`

List available rules.

```sh
quality-gate rules
quality-gate rules --plugin @quality-gate/rules-git
quality-gate rules --json
```

### `explain`

Explain active configuration for a path or package.

```sh
quality-gate explain
quality-gate explain packages/api/src/index.ts
quality-gate explain --rule gitkeep/no-lone-gitkeep
```

### `cache`

Inspect or clear persistent cache.

```sh
quality-gate cache status
quality-gate cache clear
quality-gate cache clear --workspace .
quality-gate cache clear --workspace quality-gate --plugin @quality-gate/rules-typescript
quality-gate cache clear --path packages/api/src/index.ts
```

## Exit Codes

- `0`: no failing diagnostics.
- `1`: diagnostics exceeded configured failure threshold.
- `2`: invalid config, plugin load failure, or CLI usage error.
- `3`: internal runner error.

## Config

Initial TypeScript config shape:

```ts
import { defineConfig } from "quality-gate";

export default defineConfig({
  scan: {
    defaultMode: "changed",
    base: "origin/main",
  },
  plugins: ["@quality-gate/rules-git"],
  rules: {
    "gitkeep/no-lone-gitkeep": "error",
  },
  overrides: [
    {
      files: ["packages/api/**"],
      rules: {},
    },
  ],
});
```

The config should support JavaScript/TypeScript first because custom rules and dynamic monorepo policies are expected. JSON/YAML can be added later for static environments.
