# CLI

Quality Gate uses the same runner for standalone checks and the optional
project daemon. Examples below use `quality-gate`; in a project with a local
installation, prefix it with `pnpm exec`.

## Commands

### `check`

Run a scan and report diagnostics.

```sh
quality-gate check
quality-gate check --staged
quality-gate check --changed --base origin/main
quality-gate check --full
quality-gate check --working-tree
quality-gate check --format json
```

The default scan mode is `changed`, unless the root config sets
`scan.defaultMode`. By default, the CLI selects staged paths and reads rule
filesystem inputs from the Git index. Configuration files are loaded from the
working tree. Use `--full` for a repository-wide working tree scan.

Supported options:

- `--changed`: select changed mode and disable the default staged selection.
- `--full`: select full mode and disable the default staged selection.
- `--base <ref>`: base ref for a non-staged ref comparison.
- `--head <ref>`: head ref for a non-staged ref comparison (default: `HEAD`).
- `--staged`: select staged changes and index contents (default).
- `--working-tree`: select unstaged tracked changes and working tree contents.
- `--format <stylish|json>`: select output format (default: `stylish`).
- `--root <path>`: workspace root (default: current directory).
- `--config <path>`: root YAML config path, relative to the workspace root or absolute.
- `-h`, `--help`: show help.

Ref comparisons use `git diff <base>...<head>`. The base is `--base`, then
`scan.base`, then `HEAD`. Thus `--changed` alone compares `HEAD...HEAD` and
normally finds no changes. Use `--changed --base origin/main` to compare a
branch against its merge base. `--base` alone does not disable staged mode.
Ref comparisons select paths from Git but read current working tree contents.
`--working-tree` uses `git diff` against the index; it excludes staged-only
changes and untracked files. Scan selection flags are processed in order, so
prefer one selection per invocation.

### `daemon`

One optional daemon can run per project. `check` uses its local socket when
available and falls back to an in-process run when no daemon can be reached.

```sh
quality-gate daemon start
quality-gate daemon status
quality-gate daemon stop
```

`start` runs in the foreground. Use another terminal for checks, or a process
supervisor to keep it running. The current implementation uses a filesystem
Unix-domain socket and requires a platform that supports it.

The daemon watches workspace directories as change hints and reads the Git
index again on each staged check. Rule-owned caches survive restarts under
`.local/cache/quality-gate/rules/`. Standalone checks use no persistent rule
cache. Add `.local/` to the project's `.gitignore`.

### `rules`

List built-in rule metadata.

```sh
quality-gate rules
quality-gate rules --format json
```

The CLI bundles its rule set; loading additional plugins through CLI flags or
configuration is not currently supported.

### `cache`

Clear one rule's persistent cache for the selected project.

```sh
quality-gate cache clear --rule docs/valid-reference
quality-gate cache clear --rule docs/valid-reference --root /path/to/project
```

Each rule owns its cache keys and refresh policy. Core provides isolated
namespaces, content hashing helpers, and atomic persistence.

## Document references

`docs/valid-reference` finds occurrences matching
`/\w+(?:\/\w+)+/`, checks that the matched repository-relative path is a
file, and reports the exact occurrence. Suppress one occurrence by placing the
marker immediately after it:

```md
not/a/file <!-- quality-gate-suppress docs/valid-reference -->
```

The marker does not suppress other occurrences on the same line. Because the
pattern also matches slash-separated prose, enable the rule in nested
`.qualitygate.yaml` files for document sets that use this reference convention.

## Exit Codes

- `0`: no error diagnostics, or a successful utility command.
- `1`: at least one error diagnostic, or daemon status/stop found no daemon.
- `2`: CLI usage, configuration, or execution error.

Warnings and informational diagnostics do not cause check failure.

## Config

The CLI automatically loads `.qualitygate.yaml` or `.qualitygate.yml`. A file
at the workspace root supplies repository defaults. A file in any nested
directory applies to that directory and all descendants, like `.gitignore`.
Nested rules inherit and override parent options; paths in nested `overrides`
are relative to the directory containing that config. Later, deeper matching
configs win. The old root-only `qualitygate.config.yaml` and `.yml` names remain
supported for compatibility.

Configuration is YAML. Supported root fields are `scan`, `rules`, and
`overrides`. `scan` is only allowed in the root config and supports
`defaultMode` (`changed` or `full`) and `base`. JavaScript/TypeScript config
files and a `defineConfig` export are not currently supported.

```yaml
# .qualitygate.yaml (repository root)
scan:
  defaultMode: changed
  base: origin/main

rules:
  files/max-bytes:
    severity: error
    options:
      limit: 1000000
      ignoredPaths: ["**/package-lock.json"]
```

```yaml
# packages/.qualitygate.yaml
rules:
  files/max-line-length:
    severity: warning
    options: { limit: 120 }

overrides:
  - files: ["*/generated/**"]
    rules:
      files/max-bytes: off
```

Rule settings accept a severity (`off`, `info`, `warning`, or `error`), a
`[severity, options]` pair, or an object with `severity` and `options`.
Omitted rules use their built-in default severity and options.

## Planned capabilities

General workspace servers, MCP/HTTP transports, workspace registration,
`init`, `explain`, dynamic plugin loading, automatic fixes, SARIF/GitHub
output, output file flags, and warning thresholds are future design goals.
They are not commands or options in the current CLI. See
[Architecture](architecture.md) and [Plugin Contract](plugin-contract.md).
