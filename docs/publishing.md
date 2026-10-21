# Publishing QG 0.1.0

This runbook publishes the eleven public packages from one reviewed Git commit.
All use version `0.1.0`, MIT licensing, and Node.js `>=24.0.0`. The repository
root is private. Internal dependencies use exact npm versions, so npm can
publish them directly. pnpm is used to reproduce the development installation
from the checked-in lockfile.

## Transfer the release commit

On the machine where changes were committed, push the release branch before
switching machines:

```sh
git push origin main
```

On the publishing machine, install Git and [mise](https://mise.jdx.dev/), then
clone the repository or update an existing clean checkout:

```sh
git clone https://github.com/slop-lab/quality-gate.git
cd quality-gate
git rev-parse HEAD
git status --short
```

For an existing checkout, use `git pull --ff-only` on the release branch.
Compare `git rev-parse HEAD` with the release commit supplied during handoff;
check out that commit if the branch has moved. `git status --short` should be
empty. Publish all packages from this same commit.

## Install the toolchain and validate

Run from the repository root:

```sh
mise install
mise exec -- just bootstrap
mise exec -- just release-check
git status --short
```

`mise.toml` pins Node.js 24.21.0, pnpm 11.10.0, Just 1.47.0, and Biome 2.5.15.
Bootstrap installs from `pnpm-lock.yaml`, builds the packages, and installs this
clone's QG pre-commit hook. `release-check` runs `qg check --full` for the full
rule scan and shared checks, including the configured full Biome check,
TypeScript build, and tests. It then previews all eleven public npm workspaces.

Repository rules also verify package release metadata and required companion
files. See [repository checks](repository-checks.md) for the policies exercised
by the release check.

Successful checks and tests print `PASS` without individual passing test names
or totals. Successful package previews also print `PASS`. Their detailed output
is shown on failure. To inspect the complete file lists explicitly, run:

```sh
mise exec -- npm pack --workspaces --dry-run --include-workspace-root=false
```

The package previews run each `prepack` script (`npm run build`) but do not
create a release or publish to a registry. Check that each preview contains
`package.json`, `README.md`, `LICENSE`, and the `dist/index.mjs` / type entry
points, and excludes test files and node_modules. A dry run does not establish
account permissions or reserve a package version. See [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

The source checkout should remain clean after validation. Fix and commit any
new change before publishing, then repeat validation on the release commit.

## Authenticate on the publishing machine

```sh
mise exec -- npm login --scope=@slop-lab --registry=https://registry.npmjs.org/
mise exec -- npm whoami --registry=https://registry.npmjs.org/
```

Use an account with publish permission for the `@slop-lab` scope. Complete the
browser login and any authentication challenge requested by npm. Keep account
credentials in the publishing machine's user configuration. See
[npm login](https://docs.npmjs.com/cli/v11/commands/npm-login/) and
[scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/).

Before publishing a package, check whether its target version already exists:

```sh
mise exec -- npm view @slop-lab/qg-core@0.1.0 version --registry=https://registry.npmjs.org/
```

Repeat this for each package in the table below. A registry 404 is expected for
a version not yet published. Authentication, permission, and network errors
need to be resolved separately. If a version already exists, follow the partial
release guidance below before proceeding.

## Publish in dependency order

Run these commands individually from the repository root. Stop at the first
failure and resolve it before continuing. Each command explicitly selects one
public workspace and the public npm registry.

| Order | Package | Purpose |
| --- | --- | --- |
| 1 | `@slop-lab/qg-core` | Shared runner, providers and file-policy helpers |
| 2 | `@slop-lab/qg-checks` | Shared command/Node check execution |
| 3 | `@slop-lab/qg-test-utils` | Custom rule testing helpers |
| 4 | `@slop-lab/qg-rules-git` | Default Git rules |
| 5 | `@slop-lab/qg-rules-files` | Default file and document rules |
| 6 | `@slop-lab/qg-rules-js` | Optional js preset |
| 7 | `@slop-lab/qg-rules-js-test` | Optional js-test preset |
| 8 | `@slop-lab/qg-rules-tools` | Independent formatter/linter adapters |
| 9 | `@slop-lab/qg-rules-cspell` | Optional CSpell plugin |
| 10 | `@slop-lab/qg-rules-recommended` | Default Git/file composition |
| 11 | `@slop-lab/qg` | CLI |

```sh
mise exec -- npm publish --workspace @slop-lab/qg-core --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg-checks --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg-test-utils --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg-rules-git --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg-rules-files --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg-rules-js --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg-rules-js-test --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg-rules-tools --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg-rules-cspell --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg-rules-recommended --access public --registry=https://registry.npmjs.org/
mise exec -- npm publish --workspace @slop-lab/qg --access public --registry=https://registry.npmjs.org/
```

The default dist-tag is `latest`. To preview the actual publish operation for a
workspace first, append `--dry-run` to its command. Publish previews are distinct
from registry writes. The workspace root must not be published.

After each successful publish, confirm that version is visible before publishing
packages that depend on it:

```sh
mise exec -- npm view @slop-lab/qg-core@0.1.0 version --registry=https://registry.npmjs.org/
```

Use the package just published in place of `qg-core`. After completing the list,
verify the CLI's version, dist-tag, and runtime dependencies:

```sh
mise exec -- npm view @slop-lab/qg@0.1.0 version dependencies engines license --json --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg dist-tags --json --registry=https://registry.npmjs.org/
```

## Verify installation outside the workspace

Use Node.js 24 or later in a fresh directory outside this repository. These
examples use a POSIX shell; create the equivalent files on other shells.

```sh
mkdir qg-release-smoke
cd qg-release-smoke
npm init -y
git init
printf '# Smoke\n' > README.md
printf '* text=auto eol=lf\n' > .gitattributes
npm install --save-dev @slop-lab/qg@0.1.0 --registry=https://registry.npmjs.org/
npx qg --help
npx qg hooks install
npx qg rules --format json
git add package.json package-lock.json README.md .gitattributes
npx qg run-hook pre-commit
npx qg check --full
```

The default rule list should contain Git/file checks, without JS, package-manager,
external-tool, or TypeScript fixture rules. JS/test rule packages should not be
installed as CLI runtime dependencies.

Verify optional presets separately:

```sh
npm install --save-dev @slop-lab/qg-rules-js@0.1.0 @slop-lab/qg-rules-js-test@0.1.0 --registry=https://registry.npmjs.org/
printf 'presets: [js, js-test]\n' > .qg.yaml
npx qg rules --format json
printf 'export const value = 1;\n' > probe.js
npx qg check --full
```

The last command should fail with `js/require-ts-check`, demonstrating that the
optional JS preset is active. Add its required directive and check again:

```sh
printf '// @ts-check\nexport const value = 1;\n' > probe.js
npx qg check --full
npm install --save-dev @slop-lab/qg-core@0.1.0 @slop-lab/qg-test-utils@0.1.0 --registry=https://registry.npmjs.org/
node --input-type=module -e 'import {createFixture, runRule, assertDiagnostic} from "@slop-lab/qg-test-utils"; console.log(typeof createFixture, typeof runRule, typeof assertDiagnostic)'
```

The utility export check should print `function function function`. See the
[test utility guide](../packages/test-utils/README.md) for custom-rule test
examples, and the [CLI guide](cli.md) for hook commands and preset configuration.

## Resume a partially completed release

Record which packages succeeded. Query their `0.1.0` metadata and compare with
the intended release. Continue from the first unpublished package only if all
already-published packages came from the same release content.

A published name/version cannot be overwritten or reused, even after unpublish.
If incorrect content was published, prepare a new release version and update
internal exact dependency versions and the lockfile before continuing. See
[npm's version rules](https://docs.npmjs.com/cli/v11/commands/npm-publish/#description).

After registry and installation verification, record the released Git commit
in your release notes. Git tags, remote pushes, and npm publishing are separate
operations; the validation commands above do not perform them.

To verify the optional CSpell plugin in a fresh consumer project:

```sh
npm install --save-dev @slop-lab/qg-rules-cspell@0.1.0 --registry=https://registry.npmjs.org/
```

Add `ruleModules: ["@slop-lab/qg-rules-cspell"]` to the root configuration and
enable `external/cspell`. It does not require a `js` preset or a CSpell CLI
installation. See the [CSpell plugin guide](../packages/rules-cspell/README.md).
