# @slop-lab/qg-rules-biome

QG adapter for Biome. This package owns Biome's read-only stdin arguments,
option validation and diagnostic mapping. It does not include or install
Biome, other adapters or language presets.

```sh
npm install --save-dev @slop-lab/qg @slop-lab/qg-rules-biome @biomejs/biome
```

```yaml
ruleModules: ["@slop-lab/qg-rules-biome"]
rules:
  external/biome: error
```

The package exports `biomeRule`, `rules` (containing only this adapter), and
`BiomeOptions`. Rules remain opt-in. Staged scans submit index contents;
full scans submit working-tree contents. Tool configuration and plugins come
from the consuming project's working tree.

Executable discovery, snapshot input and caching are supplied by
`@slop-lab/qg-stdin-adapter`. This package owns all Biome-specific behavior;
the shared factory has no adapter registry or knowledge of Biome.
See the [external tool guide](https://github.com/slop-lab/quality-gate/blob/main/docs/external-tools.md)
for configuration, caching and execution options.
