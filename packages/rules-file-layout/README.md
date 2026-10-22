# @slop-lab/qg-rules-file-layout

Allowed names/paths, required root and companion files. Requires Node.js 24 or later and depends on core.

This package is included in the CLI recommended set. Configure existing
rules without loading the package a second time. Library callers can import
individual rules or its `rules` array.

```yaml
rules:
  files/allowed-name:
    severity: error
    options: { allowedPatterns: ["[a-z0-9.-]+"] }
```

This package has no Markdown parser or content-size checks. It owns filename/path allowlists, required root README and LF attributes, and conditional companion files. Custom path rule authors use `createFilePathRule` from core.

See the [CLI guide](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for configuration, path overrides, staged scans and rule messages.
