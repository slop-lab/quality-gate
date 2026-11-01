# @slop-lab/qg-rules-files

File and document policies for QG: paths, required companions, content limits,
directory file counts, Markdown references, source-comment references,
characters, table style and suppression reasons.
Related policies share one development dependency and the Markdown parser.
Requires Node.js 24 or later.

This package is already included in the CLI recommended set. Configure its
rules directly; do not load it a second time through `ruleModules`.

```yaml
rules:
  files/max-bytes: [error, { limit: 1000000 }]
  docs/valid-reference: error
  source/valid-reference: error
  files/allowed-name:
    severity: error
    options: { allowedPatterns: ["[a-z0-9.-]+"] }
```

Library callers can import individual rules, the full `rules` collection, or
`layoutRules`, `fileLimitRules`, `markdownRules`, and `sourceRules`. `presets` exposes those
four library selections as `layout`, `limits`, `markdown`, and `source`; these are not
additional CLI preset names. `fileRules` retains the content-limit collection.
Core callers can compose the desired arrays explicitly with `runQualityGate`.

All existing rule IDs, options, defaults, path overrides and generated-file
behavior remain intact. Generic custom path rule authors use
`createFilePathRule` from core. See the
[CLI guide](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for configuration and staged scans.

`createValidFileReferenceRule` composes versioned `FileReferencePlugin`
extractors into externally reusable rules. The built-in source extractor checks
whole-line slash comments. See the
[source reference guide](https://github.com/slop-lab/quality-gate/blob/main/docs/source-references.md).
