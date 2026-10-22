# @slop-lab/qg-rules-files

File and document policies for QG: paths, required companions, content limits,
directory file counts, Markdown references, characters and suppression reasons.
Related policies share one development dependency and the Markdown parser.
Requires Node.js 24 or later.

This package is already included in the CLI recommended set. Configure its
rules directly; do not load it a second time through `ruleModules`.

```yaml
rules:
  files/max-bytes: [error, { limit: 1000000 }]
  docs/valid-reference: error
  files/allowed-name:
    severity: error
    options: { allowedPatterns: ["[a-z0-9.-]+"] }
```

Library callers can import individual rules, the full `rules` collection, or
`layoutRules`, `fileLimitRules`, and `markdownRules`. `presets` exposes those
three library selections as `layout`, `limits`, and `markdown`; these are not
additional CLI preset names. `fileRules` retains the content-limit collection.
Core callers can compose the desired arrays explicitly with `runQualityGate`.

All existing rule IDs, options, defaults, path overrides and generated-file
behavior remain intact. Generic custom path rule authors use
`createFilePathRule` from core. See the
[CLI guide](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for configuration and staged scans.
