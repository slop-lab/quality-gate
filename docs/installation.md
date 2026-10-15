# Installation

## Requirements

- Git
- [mise](https://mise.jdx.dev/)

The repository's `mise.toml` installs compatible Node.js, pnpm, Just, and
Biome versions. No separately installed global Node.js toolchain is required.

## Install the CLI from source

Quality Gate is not published to a registry yet. On a new machine:

```sh
git clone <quality-gate-repository-url>
cd quality-gate
mise trust
mise install
mise exec -- just install-cli
```

`install-cli` performs a frozen dependency install, builds every workspace
package, installs a small `quality-gate` launcher in `$XDG_BIN_HOME` or
`~/.local/bin`, and runs a smoke test. The launcher always executes with the
checkout's pinned mise toolchain, so it also works outside the checkout.

Verify the installation from outside the checkout:

```sh
quality-gate rules
quality-gate --help
```

If the install command says the bin directory is not on `PATH`, add that
directory to your shell configuration and open a new shell. To choose another
location, set `QUALITY_GATE_BIN_DIR` while installing and uninstalling:

```sh
QUALITY_GATE_BIN_DIR=/path/on/PATH mise exec -- just install-cli
```

The command is linked to the checkout rather than copied. Do not delete or move
the checkout while using this installation. After moving it, run
`install-cli` again from the new location.

## Add Quality Gate to a project

Create `.qualitygate.yaml` at the project root and ignore local runtime data:

```yaml
scan:
  defaultMode: changed

rules:
  git/no-tracked-local-files: error
  files/max-bytes:
    severity: error
    options: { limit: 1000000 }
```

```gitignore
.local/
```

Run the default staged check:

```sh
git add .
quality-gate check
```

Run the repository-wide check in CI:

```sh
quality-gate check --full
```

## Pre-commit hook

Put the following executable file at `.git/hooks/pre-commit`:

```sh
#!/bin/sh
set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
exec quality-gate check
```

Then enable it:

```sh
chmod +x .git/hooks/pre-commit
```

The default check reads both paths and content from the Git index, so partially
staged files are checked exactly as they will be committed.

## Optional project daemon

The hook works without a daemon. For a frequently used project, start one from
its repository root:

```sh
quality-gate daemon start
```

Run it under the process supervisor of your choice if it should survive shell
logout or machine restart. Other commands automatically use the project's
socket when present and otherwise fall back to an in-process check.

Persistent rule caches live at `.local/cache/quality-gate/`, so they remain
available after the daemon restarts.

## Update or remove

Update from the source checkout:

```sh
git pull --ff-only
mise install
mise exec -- just install-cli
```

Remove the global link:

```sh
mise exec -- just uninstall-cli
```

Project caches can be removed independently because they are reproducible:

```sh
quality-gate daemon stop
rm -rf .local/cache/quality-gate
```
