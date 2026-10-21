# QG external tool rules

`@slop-lab/qg-rules-tools` provides independent Biome, Prettier, and ESLint
adapters. It has no dependency on JS/test presets or on the tools themselves.
Install the adapters and the tools your project uses:

```sh
npm install --save-dev @slop-lab/qg-rules-tools @biomejs/biome
```

Load only the desired adapter through its package entry point:

```yaml
ruleModules: ["@slop-lab/qg-rules-tools/biome"]
rules:
  external/biome:
    severity: error
    options: { mode: format }
```

The other entry points are `@slop-lab/qg-rules-tools/prettier` and
`@slop-lab/qg-rules-tools/eslint`. Each exports its rule, `rules`, and the
`ExternalToolOptions` type. The package root exports all individual rules,
`externalToolRules`, and `rules` for callers wanting the combined set.
Rules are opt-in and never download or install tools during checks.

Adapters submit index text for staged scans and working-tree text for full
scans, keeping the original filename for tool configuration discovery.
Configuration, imported modules and tool plugins come from the working tree.
The adapters honor QG path overrides and generated-artifact exclusions.
They retain failure diagnostics and never write source files.

The shared implementation provides executable discovery, snapshot stdin,
cache keys, and diagnostics for all three tools. Entry points give consumers
language-independent selection without maintaining three separate packages.
For protocol, configuration, caching, and server options, see the
[external tool guide](https://github.com/slop-lab/quality-gate/blob/main/docs/external-tools.md).
