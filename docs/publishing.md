# Publishing QG packages

This runbook publishes changed public packages and their dependents from one
reviewed Git commit. Packages are versioned independently; internal dependencies
use exact npm versions so npm can publish them directly. The repository root
(`@this-project/qg-repo`) is private. pnpm is used to reproduce the development
installation from the checked-in lockfile.

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

`mise.toml` pins Node.js, pnpm, Just, and Biome. It also pins Python and Rust
for the consumer example tests.
Bootstrap installs from `pnpm-lock.yaml`, builds the packages, and installs this
clone's QG pre-commit hook. `release-check` runs `qg check --full` for the full
rule scan and shared checks, including the configured full Biome check,
TypeScript build, and tests. It then previews all public npm workspaces.

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

Before publishing, install the packed CLI and its unpublished runtime
dependencies in a temporary npm project outside this checkout. Pack QG, core,
the check runner, and the Git, file, and recommended rule packages. Verify
`npm ls @slop-lab/qg-check-runner` reports `0.1.1` under QG and run
`npx --no-install qg --help` there. Repeat the installation check below after
the registry release.

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

Before starting the release, check whether the target versions already exist.
Check all eleven packages in this release.

```sh
mise exec -- npm view @slop-lab/qg-core@0.1.1 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg-rules-git@0.1.1 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg-rules-files@0.1.1 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg-rules-recommended@0.1.1 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg-check-runner@0.1.1 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg-check-node-test@0.1.0 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg-check-unittest@0.1.0 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg-check-jest@0.1.0 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg-check-vitest@0.1.0 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg-check-cargo@0.1.0 version --registry=https://registry.npmjs.org/
mise exec -- npm view @slop-lab/qg@0.1.1 version --registry=https://registry.npmjs.org/
```

A registry 404 is expected for a version not yet published. Authentication,
permission, and network errors need to be resolved separately. If a version
already exists, follow the partial release guidance below before proceeding.

## Publish in dependency order

Run the release script from the repository root. It publishes one workspace at
a time to the public npm registry and stops at the first failed publish. After
each successful publish it proceeds to the next workspace, since registry
reads may lag behind writes.

| Package | Purpose |
| --- | --- |
| `@slop-lab/qg-core@0.1.1` | Exports versioned plugin fingerprints and extensible recheck triggers |
| `@slop-lab/qg-rules-git@0.1.1` | Rejects ignored files that remain tracked |
| `@slop-lab/qg-rules-files@0.1.1` | Contains file-reference plugins and Markdown table fixes |
| `@slop-lab/qg-rules-recommended@0.1.1` | Enables the new Git, Markdown, and source-reference rules |
| `@slop-lab/qg-check-runner@0.1.1` | Exports `collectCheckArtifacts` for the CLI |
| `@slop-lab/qg-check-node-test@0.1.0` | Node test adapter, command helper, and reporter |
| `@slop-lab/qg-check-unittest@0.1.0` | Python test adapter |
| `@slop-lab/qg-check-jest@0.1.0` | Jest test adapter |
| `@slop-lab/qg-check-vitest@0.1.0` | Vitest test adapter |
| `@slop-lab/qg-check-cargo@0.1.0` | Cargo test adapter and output discovery |
| `@slop-lab/qg@0.1.1` | Pins the new check runner and recommended rules |

```sh
mise exec -- node scripts/publish-release.mjs
```

The default dist-tag is `latest`. Preview the publish operations with:

```sh
mise exec -- node scripts/publish-release.mjs --dry-run
```

After the full release propagates, verify the CLI's version, dist-tag, and
runtime dependencies:

```sh
mise exec -- npm view @slop-lab/qg@0.1.1 version dependencies engines license --json --registry=https://registry.npmjs.org/
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
npm install --save-dev @slop-lab/qg@0.1.1 --registry=https://registry.npmjs.org/
npm ls @slop-lab/qg-check-runner
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
npm install --save-dev @slop-lab/qg-rules-js@0.1.0 --registry=https://registry.npmjs.org/
printf 'presets: [js]\n' > .qg.yaml
npx qg rules --format json
printf 'export const value = 1;\n' > probe.js
npx qg check --full
```

The last command should fail with `js/require-ts-check`, demonstrating that the
optional JS preset is active. Add its required directive and check again:

```sh
printf '// @ts-check\nexport const value = 1;\n' > probe.js
npx qg check --full
npm install --save-dev @slop-lab/qg-core@0.1.1 @slop-lab/qg-rule-testing@0.1.0 --registry=https://registry.npmjs.org/
node --input-type=module -e 'import {createFixture, runRule, assertDiagnostic} from "@slop-lab/qg-rule-testing"; console.log(typeof createFixture, typeof runRule, typeof assertDiagnostic)'
```

The utility export check should print `function function function`. See the
[test utility guide](../packages/rule-testing/README.md) for custom-rule test
examples, and the [CLI guide](cli.md) for hook commands and preset configuration.

## Resume a partially completed release

Record which packages succeeded. Query their target-version metadata and compare
with the intended release. Continue from the first unpublished package only if
all already-published packages came from the same release content. Run the
remaining publishes individually in the order listed above. For example, if
the check runner is the first unpublished package, start with:

```sh
mise exec -- npm publish --workspace @slop-lab/qg-check-runner --access public --registry=https://registry.npmjs.org/
```

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
enable `external/cspell`. It does not require a `js-directives` preset or a CSpell CLI
installation. See the [CSpell plugin guide](../packages/rules-cspell/README.md).
