# @slop-lab/qg-rules-package-json

package.json name policies. Requires Node.js 24 or later and depends on core.

Install the package in the consuming project:

```sh
npm install --save-dev @slop-lab/qg-rules-package-json
```


```yaml
ruleModules: ["@slop-lab/qg-rules-package-json"]
rules:
  package/allowed-name:
    severity: error
    options:
      allowedPatterns: ["@my-org/[^/]+", "@this-project/[^/]+"]
```

Exports `allowedPackageNameRule`, `AllowedPackageNameOptions` and `rules`. Name restrictions are opt-in and match each entire package name. Public and local package naming can be selected with regular-expression allowlists. It has no JavaScript source or pnpm rules.

See the [CLI guide](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for configuration, path overrides, staged scans and rule messages.
