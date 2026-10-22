# @slop-lab/qg-rules-markdown

Markdown references, characters and suppression reasons. Requires Node.js 24 or later and depends on core, Markdown parser.

This package is included in the CLI recommended set. Configure existing
rules without loading the package a second time. Library callers can import
individual rules or its `rules` array.

```yaml
rules:
  docs/valid-reference: error
```

This package owns local Markdown link validation, character policy and suppression-reason requirements. The Markdown parser is confined to this package; layout and limit checks do not depend on it.

See the [CLI guide](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for configuration, path overrides, staged scans and rule messages.
