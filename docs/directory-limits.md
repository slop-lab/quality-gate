# Directory file limits and self-only configuration

`files/max-files-per-directory` is enabled in the recommended rule set.
It counts each directory's direct file entries, without adding files from
child directories:

| Direct file count | Result |
| --- | --- |
| 0 through 50 | Pass |
| 51 through 100 | Warning |
| 101 or more | Error |

Each directory produces one diagnostic at its highest applicable level.
Subdirectories do not count as files, and their contents are checked
independently. Dotfiles, including `.qg.yaml`, count as files. Generated
artifacts are excluded by default through the shared
[artifact registry](generated-artifacts.md).

```yaml
rules:
  files/max-files-per-directory:
    severity: error
    options:
      warningLimit: 50
      limit: 100
```

`warningLimit` and `limit` are non-negative integers. `limit` is the error
maximum; counts must exceed a maximum to trigger that level. A `warning` or
`info` rule severity caps both levels. If the warning maximum is greater than
or equal to the error maximum, there is no warning interval.

Additional options:

- `includeGenerated`: count generated files too; defaults to `false`.
- `ignoredPaths`: root-relative globs for files or directory checks to ignore;
  defaults to an empty list.
- `ignoredDirectories`: directory names to ignore; defaults to `.git`, `.local`,
  `.qg`, `node_modules`, and `dist`.

Full scans check eligible directories throughout the project. Changed scans
check the immediate parent directories of changed paths, including deleted
files and old rename locations. The count includes all current files in an
affected directory, rather than only changed files. Removed directories are
skipped. Staged scans use Git index listings, so unstaged additions and
deletions do not affect the count.

## Configure only the current directory

Overrides now accept a `directory` selector and `scope`:

- `scope: self` applies settings to the selected directory itself and its
  direct files. Child directories and their files keep their inherited settings.
- `scope: subtree` is the default and includes the selected directory and all
  descendants.

For example, change the limit for `src` without changing its child directories:

```yaml
overrides:
  - directory: src
    scope: self
    rules:
      files/max-files-per-directory:
        severity: error
        options: { warningLimit: 80, limit: 120 }
```

Self-only overrides change settings locally; they do not disable default rules
under child directories. To run the file-count rule **only** for `src`, disable
it globally and opt that directory back in:

```yaml
# Root .qg.yaml
rules:
  files/max-files-per-directory: off

overrides:
  - directory: src
    scope: self
    rules:
      files/max-files-per-directory: error
```

For the repository root itself, use `directory: .`.

The same override can live in the selected directory's own configuration:

```yaml
# src/.qg.yaml
overrides:
  - scope: self
    rules:
      files/max-files-per-directory: error
```

When `scope` is present without `directory`, the directory containing that
configuration is selected. Ordinary top-level `rules` in nested configurations
keep their existing behavior: they apply to that directory and descendants.

## Select direct files for other rules

The scope feature is shared by all rules that resolve file or directory
configuration. With `directory` or `scope` present, `files` and `excludedFiles`
are relative to the selected directory:

```yaml
overrides:
  - directory: src
    scope: self
    files: ["*.ts"]
    excludedFiles: ["legacy.ts"]
    rules:
      files/max-lines: [error, { warningLimit: 300, limit: 600 }]
```

This changes `src/app.ts` but not `src/legacy.ts` or `src/nested/app.ts`.
Without a directory selector or scope, existing file-glob overrides retain
their previous behavior and paths are relative to the containing config.
With a directory selector and no `files`, the file filter defaults to `**`.
Directory selectors are project-relative paths in library configuration and
config-relative paths in CLI YAML; they cannot escape with `..` or absolute
paths. Nested configurations still override parent settings in the existing
order.

Rule authors resolve an aggregate directory's configuration with
`context.resolveConfig(directory, "directory")`. A diagnostic whose `path`
is a directory sets `pathKind: "directory"` so the runner applies the same
configuration when filtering diagnostics and resolving severity. The default
path kind is `file`, including diagnostics from directory-scoped rules that
point at an individual file. `scope: "directory"` describes a rule/diagnostic's
logical scope; it does not imply that its path is a directory.
