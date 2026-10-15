# QG

`@slop-lab/qg` provides the `qg` CLI for repository quality checks.
Requires Node.js 22 or later.

The CLI uses `@slop-lab/qg-core` and `@slop-lab/qg-rules-recommended` as runtime
dependencies. Your package manager installs these and the individual rule
packages automatically.

```sh
pnpm add -D @slop-lab/qg
pnpm exec qg rules
pnpm exec qg check
pnpm exec qg check --full
```

By default, checks inspect staged paths and index contents. `--full` scans the
working tree. Configure rules with `.qg.yaml` or `.qg.yml` at the project root;
nested config files apply to their directory and descendants.

```yaml
rules:
  git/no-tracked-local-files: error
  docs/valid-reference: off
  files/max-bytes:
    severity: error
    options: { limit: 1000000 }
```

An optional project daemon supports persistent rule caches:

```sh
pnpm exec qg daemon start
# Run in another terminal:
pnpm exec qg daemon status
pnpm exec qg check
pnpm exec qg daemon stop
```

The daemon runs in the foreground and uses named pipes on Windows or Unix-domain
sockets on other platforms. Add `.local/` to the project's `.gitignore` for
runtime data under `.local/cache/qg/`.

Recommended checks include `markdown/allowed-characters` (ASCII by default)
and `qg/require-suppression-reason`. Add `allowedLanguages` or
`allowedCharacters` through rule options for multilingual documents. Inline
suppression comments require a reason and support word, line, next-line,
and paired start/end scopes.

See the [CLI reference](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for all commands and configuration options.
