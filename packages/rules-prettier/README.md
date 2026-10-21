# @slop-lab/qg-rules-prettier

QG adapter for Prettier. This package owns Prettier's read-only stdin arguments,
option validation and diagnostic mapping. It does not include or install
Prettier, other adapters or language presets.

```sh
npm install --save-dev @slop-lab/qg @slop-lab/qg-rules-prettier prettier
```

```yaml
ruleModules: ["@slop-lab/qg-rules-prettier"]
rules:
  external/prettier: error
```

The package exports `prettierRule`, `rules` (containing only this adapter), and
`PrettierOptions`. Rules remain opt-in. Staged scans submit index contents;
full scans submit working-tree contents. Tool configuration and plugins come
from the consuming project's working tree.

Executable discovery, snapshot input and caching are supplied by
`@slop-lab/qg-rule-stdin`. This package owns all Prettier-specific behavior;
the shared factory has no adapter registry or knowledge of Prettier.
See the [external tool guide](https://github.com/slop-lab/quality-gate/blob/main/docs/external-tools.md)
for configuration, caching and execution options.
