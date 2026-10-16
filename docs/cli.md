# CLI

Quality Gate uses the same runner for standalone checks and the optional
project daemon. Examples below use `qg`; in a project with a local
installation, prefix it with `pnpm exec`.

## Commands

### `check`

Run a scan and report diagnostics.

```sh
qg check
qg check --staged
qg check --changed --base origin/main
qg check --full
qg check --working-tree
qg check --format json
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
qg daemon start
qg daemon status
qg daemon stop
```

`start` runs in the foreground. Use another terminal for checks, or a process
supervisor to keep it running. Windows uses a named pipe derived from the
absolute project path; other platforms use a Unix-domain socket at
`.local/cache/qg/daemon.sock`. Named pipes are released automatically
when the daemon stops. Persistent caches use the same project-local directory
on every platform.
Restart running daemons after updating the CLI so clients and the daemon use
the same protocol version.

The daemon watches workspace directories as change hints and reads the Git
index again on each staged check. Rule-owned caches survive restarts under
`.local/cache/qg/rules/`. Standalone checks use no persistent rule
cache. Add `.local/` to the project's `.gitignore`.

### `rules`

List built-in rule metadata.

```sh
qg rules
qg rules --format json
```

The CLI loads its default set from the runtime dependency
`@slop-lab/qg-rules-recommended`. Core and the rule packages are installed as
separate dependencies. Loading additional plugins through CLI flags or
configuration is not currently supported.

### `cache`

Clear one rule's persistent cache for the selected project.

```sh
qg cache clear --rule docs/valid-reference
qg cache clear --rule docs/valid-reference --root /path/to/project
```

Each rule owns its cache keys and refresh policy. Core provides isolated
namespaces, content hashing helpers, and atomic persistence.

## Document references

`docs/valid-reference` finds occurrences matching
`/\w+(?:\/\w+)+/`, checks that the matched repository-relative path is a
file, and reports the exact occurrence. Suppress one occurrence by placing the
marker immediately after it:

```md
not/a/file <!-- qg-suppress docs/valid-reference: illustrative missing path -->
```

The marker suppresses only the preceding word. Because the
pattern also matches slash-separated prose, enable the rule in nested
`.qg.yaml` files for document sets that use this reference convention.

## File length and generated artifacts

`files/max-lines` warns above 500 lines and errors above 1000 lines by default.
Its `warningLimit` and `limit` options control those thresholds. Generated
lockfiles and other registered artifacts are skipped across participating
content rules. Add shared patterns through root `artifacts.generated.include`,
use `exclude` for source exceptions, or enable `includeGenerated` for one rule.
See [generated artifacts](generated-artifacts.md) for defaults and extension
registration.

`files/max-files-per-directory` counts direct files per directory, warning above
50 and erroring above 100. Generated files are excluded by default. See
[directory limits](directory-limits.md) for options and self-only settings.

## Required repository and companion files

`repo/require-readme` and `repo/require-gitattributes` are enabled by default.
They require root `README.md` and a root `.gitattributes` establishing
`* text=auto eol=lf`, including during changed and staged scans.
The opt-in `files/required-companions` rule supports conditions based on nearby
files, such as requiring a package README wherever a manifest exists.
See [file policies](file-policies.md) for configuration and discovery semantics.

## JavaScript type checking

`js/require-ts-check`, provided by `@slop-lab/qg-rules-js`, is enabled in the
recommended rule set. JavaScript files must have an effective `// @ts-check`
directive before executable code. It checks `.js`, `.jsx`, `.mjs`, and `.cjs`
files in full or changed scans, using index contents for staged checks.

```js
#!/usr/bin/env node
// @ts-check
console.log("Checked JavaScript");
```

Leading whitespace and copyright comments are allowed. A string containing
the directive, a block comment, or a comment after code does not count.
The last leading `@ts-check` or `@ts-nocheck` directive wins. The rule requires
the explicit file directive even when a project's TypeScript config sets
`checkJs: true`.

```yaml
rules:
  js/require-ts-check:
    severity: error
    options:
      ignoredPaths: ["vendor/**", "**/*.min.js"]
```

`extensions` and `ignoredDirectories` can override the defaults. `.git`,
`.local`, `.qg`, `node_modules`, and `dist` are ignored by default. Nested
configuration and path overrides can disable the rule for specific files.

## Markdown characters

`markdown/allowed-characters` is enabled by the recommended rule set. It
checks `.md`, `.markdown`, and `.mdx` files (case-insensitive), including code
blocks, links, and comments. The default allows printable ASCII U+0020 through
U+007E plus tab, CR, and LF. This includes English letters, digits, straight
quotes (`'` and `"`), and ASCII Markdown punctuation. Curly quotes, Unicode
dashes, non-breaking spaces, zero-width characters, emoji, and non-ASCII
letters require an explicit exception. Diagnostics identify each character
with its Unicode code point and one-based line and UTF-16 column.

Add languages or characters in the project's `.qg.yaml`:

```yaml
rules:
  markdown/allowed-characters:
    severity: error
    options:
      allowedLanguages: [ko, ja]
      allowedCharacters: ["\u2192"] # An arrow; literal characters also work.
      ignoredPaths: ["vendor/**"]
  qg/require-suppression-reason: error
```

`allowedLanguages` accepts language tags such as `ko`, `ja`, `fr`, or
`zh-TW` and permits letters, marks, and numbers in their writing systems.
Korean permits Hangul; Japanese permits Hiragana, Katakana, and Han.
These are writing-system allowances, not dictionary checks. Punctuation and
invisible formatting characters remain restricted. English tags retain the
ASCII baseline. `allowedScripts` accepts Unicode script names such as `Greek`
or `Cyrillic` for explicit writing-system control. `allowedCharacters` adds
the code points in each string, including explicitly requested punctuation.
Unicode escapes work in YAML double-quoted strings.

`extensions` can override the checked file extensions. `ignoredPaths` accepts
repository-relative globs; nested configs and path overrides work as for other
rules. `.git`, `.local`, `.qg`, `node_modules`, and `dist` are excluded from
document discovery.

## Suppressions

The runner applies HTML-comment directives to diagnostics with a file path and
line number. Name the rule (or comma-separated rule IDs), then add a reason
after `:`. `qg/require-suppression-reason` checks Markdown by default and
requires non-empty reasons for every suppression except the closing end
marker. Configure its `extensions` or `ignoredPaths` to change its file scope.
Its diagnostics cannot themselves be suppressed by comments; project config
can change or disable the rule.

The default scope is the immediately preceding whitespace-delimited word,
including attached quotes or punctuation. A marker can touch the word or be
separated by ASCII spaces or tabs, and must stay on the same line. It covers
all invalid characters in that word, not other words or other rules:

```md
“quoted” <!-- qg-suppress markdown/allowed-characters: preserve source spelling -->
```

Use these forms for a larger, explicit scope:

```md
“two” “words” <!-- qg-suppress-line markdown/allowed-characters: verbatim quotation -->
<!-- qg-suppress-next-line markdown/allowed-characters: original language -->
한글
<!-- qg-suppress-start markdown/allowed-characters: verbatim excerpt -->
日本語
“quotation”
<!-- qg-suppress-end -->
```

`qg-suppress-line` covers the comment's starting line. `qg-suppress-next-line`
covers the line after the comment ends. Paired start/end directives cover
content between the two comments and support nesting. An end marker without
rule IDs closes the most recent open group; specifying rule IDs closes the
latest open range for each listed rule. Unmatched starts or ends do not
suppress anything. Comments are recognized in source text, including code
examples. In staged mode, both text and suppression comments come from the
Git index.

## Exit Codes

- `0`: no error diagnostics, or a successful utility command.
- `1`: at least one error diagnostic, or daemon status/stop found no daemon.
- `2`: CLI usage, configuration, or execution error.

Warnings and informational diagnostics do not cause check failure.

## Config

The CLI automatically loads `.qg.yaml` or `.qg.yml`. A file
at the workspace root supplies repository defaults. A file in any nested
directory normally applies to that directory and all descendants, like `.gitignore`.
Nested rules inherit and override parent options; paths in nested `overrides`
are relative to the directory containing that config. Later, deeper matching
configs win. The root-only alternatives `qg.config.yaml` and `qg.config.yml`
are also supported.
For settings that should apply only to a directory and its direct files,
use an override with `directory` and `scope: self`. A nested override may use
`scope: self` alone to select the directory containing that config. With a
directory selector or scope, optional `files`/`excludedFiles` filters are
relative to the selected directory; omitted `files` defaults to `**`.
See [directory limits](directory-limits.md) for examples. This controls which
settings inherit; ordinary rules elsewhere retain their existing defaults.

Configuration is YAML. Supported root fields are `scan`, `artifacts`, `rules`,
and `overrides`. `artifacts` and `scan` are only allowed in the root config; `scan` supports
`defaultMode` (`changed` or `full`) and `base`. JavaScript/TypeScript config
files and a `defineConfig` export are not currently supported.

```yaml
# .qg.yaml (repository root)
scan:
  defaultMode: changed
  base: origin/main

rules:
  files/max-bytes:
    severity: error
    options:
      limit: 1000000
      ignoredPaths: ["vendor/**"]
```

```yaml
# packages/.qg.yaml
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
Omitted rules use their built-in enabled state, severity, and options.
`external/biome`, `external/prettier`, and `external/eslint` are off by default.
See [external tools](external-tools.md) for configuration, snapshot behavior,
and daemon/cache support.

## Planned capabilities

General workspace servers, MCP/HTTP transports, workspace registration,
`init`, `explain`, dynamic plugin loading, automatic fixes, SARIF/GitHub
output, output file flags, and warning thresholds are future design goals.
They are not commands or options in the current CLI. See
[Architecture](architecture.md) and [Plugin Contract](plugin-contract.md).
