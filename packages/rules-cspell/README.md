# @slop-lab/qg-rules-cspell

Optional CSpell spelling checks for QG. This package works with documentation
and source files in any language; it is independent of the JS preset and the
default recommended rules. It depends on `cspell-lib`, so a separate CSpell CLI
installation is unnecessary.

```sh
npm install --save-dev @slop-lab/qg @slop-lab/qg-rules-cspell
```

Add to the root `.qg.yaml`:

```yaml
ruleModules: ["@slop-lab/qg-rules-cspell"]
rules:
  external/cspell:
    severity: error
    message: "Fix the spelling or add intentional terms to the project dictionary."
    options:
      files: ["**/*.md", "src/**"]
      ignoredPaths: ["vendor/**"]
```

The rule is disabled until explicitly enabled. Run `qg`, `qg check --full`, or
`qg run-hook pre-commit`; it participates in the same rule pipeline. Diagnostics
include the offending word, one-based UTF-16 line/column positions, and optional
suggestions in metadata. Standard QG severity, recovery messages, nested
configuration, overrides, and located suppression directives apply.

Create a project `cspell.json` for terms and spelling policies:

```json
{
  "version": "0.2",
  "language": "en",
  "words": ["QG"],
  "ignorePaths": ["CHANGELOG.md"]
}
```

CSpell discovers configuration starting from each document's path. Its config
imports, dictionaries, `words`, `flagWords`, `ignorePaths`, overrides, and inline
CSpell directives are supported. See the official
[CSpell configuration guide](https://cspell.org/docs/configuration) and
[`spellCheckDocument` API](https://cspell.org/docs/api/cspell-lib/functions/spellCheckDocument).

| QG rule option | Default | Meaning |
| --- | --- | --- |
| `files` | `["**"]` | Root-relative globs selecting files. |
| `ignoredPaths` | `[]` | Root-relative file exclusions. |
| `ignoredDirectories` | `.git`, `.local`, `.qg`, `node_modules`, `dist` | Directory names skipped during discovery and checking. |
| `configFile` | nearest discovered config | Explicit config path, relative to the QG project root or absolute. |
| `locale` | CSpell settings | Document locale, for example `en-GB`. |
| `generateSuggestions` | `false` | Include suggestions in diagnostic metadata. |
| `includeGenerated` | `false` | Include files excluded by QG generated-artifact classification. |

Full scans discover files from the project root. Changed scans check changed
file paths, deduplicating rename/copy destinations and skipping deletions.
Staged scans read file text from the Git index, so unstaged corrections cannot
hide staged mistakes. Each selected file is checked in full, including unchanged
lines; diagnostics are not restricted to added or modified diff lines.
Configuration and dictionaries are read from the working
tree. The rule does not write files or dictionaries. It skips binary and
non-UTF-8 inputs and respects CSpell's own document exclusions. It does not apply
the CSpell CLI's additional `.gitignore` selection; use `files`, `ignoredPaths`,
or CSpell `ignorePaths` to control selection.

QG does not persistently cache this rule's results. CSpell configuration and
dictionary caches are refreshed at the beginning of every rule invocation so
changes take effect in a persistent QG daemon. Plugin scans are serialized
within a process while these process-wide caches are refreshed and used.
Configuration, import, and dictionary errors fail the scan with details.

Library consumers can import `cspellRule`, `rules`, `ruleProvider`, and the
`CSpellRuleOptions` type from this package. `ruleProvider` implements the public
`RuleProvider<CSpellRuleOptions>` interface from `@slop-lab/qg-core`.
