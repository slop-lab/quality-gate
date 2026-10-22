# @slop-lab/qg-rules-pnpm

pnpm workspace and lockfile integrity. Requires Node.js 24 or later and depends on core.

Install the package in the consuming project:

```sh
npm install --save-dev @slop-lab/qg-rules-pnpm
```


```yaml
ruleModules: ["@slop-lab/qg-rules-pnpm"]
```

Exports `noNpmLockWithPnpmRule`, `pnpmLockfileIsCurrentRule`, `packageManagerRules` and `rules`. Rules activate when pnpm workspace inputs are present. Lockfile validation materializes an isolated workspace from the injected filesystem snapshot, disables install scripts, and cleans up afterward. The pnpm executable is supplied by the consuming project.

See the [CLI guide](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for configuration, path overrides, staged scans and rule messages.
