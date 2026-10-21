# @slop-lab/qg-rules-eslint

QG adapter for ESLint. This package owns ESLint's read-only stdin arguments,
option validation and diagnostic mapping. It does not include or install
ESLint, other adapters or language presets.

```sh
npm install --save-dev @slop-lab/qg @slop-lab/qg-rules-eslint eslint
```

```yaml
ruleModules: ["@slop-lab/qg-rules-eslint"]
rules:
  external/eslint: error
```

The package exports `eslintRule`, `rules` (containing only this adapter), and
`ESLintOptions`. Rules remain opt-in. Staged scans submit index contents;
full scans submit working-tree contents. Tool configuration and plugins come
from the consuming project's working tree.

Executable discovery, snapshot input and caching are supplied by
`@slop-lab/qg-rule-stdin`. This package owns all ESLint-specific behavior;
the shared factory has no adapter registry or knowledge of ESLint.
See the [external tool guide](https://github.com/slop-lab/quality-gate/blob/main/docs/external-tools.md)
for configuration, caching and execution options.
