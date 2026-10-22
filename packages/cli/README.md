# QG

`@slop-lab/qg` provides the `qg` CLI for repository quality checks.
Requires Node.js 24 or later.

The CLI uses core, `@slop-lab/qg-check-runner`, and recommended rules as runtime
dependencies. The default set contains Git and file checks. JavaScript and
TypeScript test rules are separate optional packages.

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
  docs/valid-reference: error
  files/max-bytes:
    severity: error
    options: { limit: 1000000 }
```

For JS/TS projects, install `@slop-lab/qg-rules-js` and select `presets: [js]`.
It contains source directives, test fixture, package manifest and pnpm policies.
Use per-rule settings or focused `js-directives` / `js-test-fixtures` presets
from the same package. Installed packages are not activated automatically.

The CLI automatically warns on stderr if the local QG hook is missing or
outdated. Set `hooks.preCommit.installation` to `auto` to install or update QG hooks
automatically, or `off` to skip hook setup. The default is `check` (warn only). Rule diagnostics and exit status remain independent.

Install a Git pre-commit hook with the published package:

```sh
pnpm exec qg hooks install
pnpm exec qg run-hook pre-commit  # run the complete hook manually
```

The CLI and hook share top-level `checks` from the root configuration. The hook
selects staged rule inputs; external command and Node tests use the working tree:

```yaml
checks:
  - name: tests
    type: node-test
    files: ["test/**/*.test.mjs"]
    message: "Fix tests before committing."
```

Load formatter/linter adapters through tool-specific modules such as
`ruleModules: ["@slop-lab/qg-rules-biome"]`, then enable `external/biome`.
This does not require a JS preset. See
[pre-commit setup](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md#run-hook-pre-commit-and-hooks-install).
Library users can run the same checks through `runChecks` from
`@slop-lab/qg-check-runner` without importing or running the CLI.

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
