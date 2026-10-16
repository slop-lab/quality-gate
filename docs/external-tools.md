# External formatters and linters

The CLI includes `external/biome`, `external/prettier`, and `external/eslint`
from `@slop-lab/qg-rules-js`. All three are **off by default**, even when their
executables or configuration files exist. They never download tools or modify
project configuration. Enable the adapters you want in `.qg.yaml`:

```yaml
rules:
  external/biome:
    severity: error
    options:
      mode: check
      files: ["src/**/*.ts", "src/**/*.tsx"]
  external/prettier:
    severity: error
    options:
      files: ["**/*.md", "**/*.yaml"]
  external/eslint: error
```

Install the selected tools as development dependencies in the target project,
for example with `pnpm add -D @biomejs/biome prettier eslint`. Configure them
using their own configuration files. QG keeps their configuration discovery,
plugins, and ignore handling; `files` only narrows the paths QG submits.
ESLint needs a configuration suitable for the selected languages, including
TypeScript plugins/parsers when checking TypeScript. QG does not generate one.

Root settings, path overrides, and nested `.qg.yaml` files can enable, disable,
or configure adapters. Glob patterns and option paths are relative to the QG
project root, including when declared in a nested QG configuration.

## Execution and snapshots

Each adapter prefers the project's installed package and launches its JS entry
point through Node. This works on Windows without executing `.cmd` shims.
If no local package resolves, QG looks for the tool on `PATH` (`biome.exe` on
Windows). It fails with an actionable error if an enabled tool cannot run.
Missing tools do not cause an enabled check to pass silently.

Full scans submit matching project files; changed scans submit only existing
changed paths, once each, excluding deletions. All adapters send the selected
filesystem snapshot through stdin with the original absolute filename.
Partially staged files are checked using index contents. Tool configurations,
plugins, imported modules, and type information are read from the working tree
by the external tool. These checks do not construct a whole-project index
snapshot, and a configuration-only change needs `qg check --full` to recheck
unchanged source files.

Checks are read-only. QG rejects write/fix/cache and protocol-changing flags in
`args`. Prettier uses `--check`; ESLint uses its JSON formatter; Biome uses its
stdin interface. ESLint diagnostics preserve locations and native rule IDs in
metadata. A QG severity of `error` retains native ESLint warnings, while
`warning` or `info` caps their severity. The CLI fails only on QG errors.

Biome 2.5.15's stdin check/lint interface returns a file-level failure rather
than individual diagnostics, even with a JSON reporter. Its `format` mode
returns formatted stdout, which QG compares with the input. Biome and Prettier
format failures therefore have no invented line/column. Use their own
diagnostic/fix commands for detailed formatting output. QG's HTML-comment
suppressions apply to located diagnostics (such as ESLint messages in markup);
unlocated format failures use project/path configuration or tool-native ignores.

## Options

| Option | Meaning |
| --- | --- |
| `files` | Include globs; defaults to common file types supported by that adapter. |
| `ignoredPaths` | Exclude globs; defaults to an empty list. |
| `ignoredDirectories` | Directory names to skip; defaults to `.git`, `.local`, `.qg`, `node_modules`, and `dist`. |
| `args` | Additional tool flags, for example `["--config", "eslint.custom.mjs"]`. Biome receives these after its subcommand. |
| `command` | Executable override, launched without a shell. |
| `commandArgs` | Arguments before tool flags/subcommands, useful for a Node entry point. |
| `env` | Environment overrides merged with the host environment. |
| `timeoutMs` | Per-process timeout; defaults to 30000 ms. |
| `cache` | Enable QG result caching when a cache store is available; defaults to `true`. |
| `cacheInputs` | Additional individual files affecting results, relative to root or absolute; all must exist. |
| `mode` | Biome only: `check` (default), `lint`, or `format`. |
| `useServer` | Biome only: connect to an already running Biome daemon; defaults to `false`. |

To run a nonstandard installation on Windows or Unix:

```yaml
rules:
  external/eslint:
    severity: error
    options:
      command: node
      commandArgs: ["tools/eslint/bin/eslint.js"]
      args: ["--config", "config/eslint.config.mjs"]
```

Default Biome extensions: JS/JSX/MJS/CJS, TS/TSX, JSON/JSONC, CSS.
Prettier also includes SCSS, HTML, Vue, YAML/YML, Markdown/MDX. ESLint includes
JS/JSX/MJS/CJS and TS/TSX. Extend `files` for additional languages/plugins.

## Daemons and caches

All three adapters work through the QG daemon and its persistent per-rule
cache. Start it in a terminal, then run checks from another terminal:

```sh
pnpm exec qg daemon start
pnpm exec qg check
pnpm exec qg cache clear --rule external/eslint
pnpm exec qg daemon stop
```

Cache entries include snapshot content, tool/version, arguments, options,
Node version, environment, extra cache inputs, and a working-tree fingerprint.
The fingerprint includes project files (including configuration and lockfiles)
outside `.git`, `.local`, `.qg`, `node_modules`, and `dist`; symlinks are not
followed. Any change to those project files conservatively invalidates results,
including changes to other sources used by type-aware or import-aware lint
rules. Each check still discovers the executable, queries its version, and
hashes these inputs before reusing results. Tool launch/configuration failures
are not cached. Cached results survive QG daemon restarts.

For configurations or dependencies outside the root, symlink targets, or
inputs under excluded directories, add the relevant files to `cacheInputs`.
After changing installed plugins without a lockfile/version change, clear the
rule cache. Set `cache: false` for nondeterministic checks or dependencies that
cannot be enumerated. External tools may execute project-supplied config and
plugins, so their own side effects remain the project's responsibility.

Standalone CLI checks have no persistent cache store. Library callers can
pass a `JsonFileRuleCacheStore` to `runQualityGate`. QG uses its own result
cache because this integration checks stdin; it does not enable the native
ESLint/Prettier file caches or assume they track cross-file dependencies.

Biome can additionally reuse its native server. Run `pnpm exec biome start`,
then set `useServer: true` on `external/biome`. QG connects with `--use-server`
and does not start or stop Biome itself. Stop it with `pnpm exec biome stop`.
A missing server is an execution error. ESLint and Prettier use one-shot CLI
processes on cache misses; QG does not invent a persistent server protocol for
them.

See the upstream [Biome CLI](https://biomejs.dev/reference/cli/),
[Prettier CLI](https://prettier.io/docs/cli), and
[ESLint CLI](https://eslint.org/docs/latest/use/command-line-interface)
for their native configuration and command options.
