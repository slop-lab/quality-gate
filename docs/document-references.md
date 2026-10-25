# Document references

`docs/valid-reference` validates actual Markdown links and images by default.
It parses Markdown syntax rather than treating slash-separated text as paths.
Fenced/inline code examples, comments, URLs, package names and ordinary prose
therefore do not need blanket exclusions.

Local destinations resolve relative to the document's directory. A leading `/`
is relative to the QG root. Percent-encoded path names are decoded; query strings
and fragments do not affect file existence. Directory targets are accepted.
External schemes, protocol-relative URLs and same-document fragments are
excluded from filesystem checks. HTML attributes and heading-anchor existence
are outside this rule's scope.

```md
[policy](file-policies.md)
[root README](/README.md)
[reference][guide]

[guide]: file-paths.md
```

Reference-style links and image references resolve through their Markdown
definitions. Diagnostics identify the link location and missing target.
Removing or renaming a file triggers revalidation of unchanged documents too.
Staged scans use the index for both the document and target; full scans use the
working tree. Generated input documents are exempt through the shared artifact
policy, while generated targets remain visible.

Use normal per-rule severity and `message` settings. Suppress illustrative links
with a scoped directive and a reason:

```md
<!-- qg-suppress-next-line docs/valid-reference: intentional missing-link example -->
[example](missing.md)
```

## Strict slash-delimited references

The original prose policy remains available explicitly:

```yaml
rules:
  docs/valid-reference:
    severity: error
    options:
      referenceStyle: slash-delimited
```

This mode finds slash-delimited tokens such as `docs/example`, resolves them
from the repository root, and requires file targets. It also interprets slash
prose as references, so use it only for documents adopting that convention.
Deleting or moving a target rechecks unchanged documents in this mode too,
including when Git represents the move as a deletion and an addition. Cached
references are checked against the current scan's filesystem on every run.
For staged scans, an untracked copy at the old path does not satisfy a reference.
The legacy `suppression` marker option applies to this mode. Default
`referenceStyle` is `markdown-links`; `extensions` can select document suffixes.
