# @slop-lab/qg-rules-js-directives

Effective JavaScript type-check directives. Requires Node.js 24 or later and depends on core.

Install the package in the consuming project:

```sh
npm install --save-dev @slop-lab/qg-rules-js-directives
```


```yaml
presets: [js-directives]
```

Exports `requireTsCheckRule`, `jsDirectiveRules` and `rules`. It requires effective leading `// @ts-check` directives in `.js`, `.jsx`, `.mjs`, and `.cjs` files, including staged index contents. It does not run the TypeScript compiler, enforce package names, or validate package-manager lockfiles.

See the [CLI guide](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for configuration, path overrides, staged scans and rule messages.
