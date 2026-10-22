# @slop-lab/qg-rules-file-limits

Bytes, lines, line length and file counts per directory. Requires Node.js 24 or later and depends on core.

This package is included in the CLI recommended set. Configure existing
rules without loading the package a second time. Library callers can import
individual rules or its `rules` array.

```yaml
rules:
  files/max-bytes: [error, { limit: 1000000 }]
```

This package has no Markdown parser. It owns `files/max-bytes`, `files/max-lines`, `files/max-line-length` and `files/max-files-per-directory`. Name/path and required-file policies live in `qg-rules-file-layout`.

See the [CLI guide](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for configuration, path overrides, staged scans and rule messages.
