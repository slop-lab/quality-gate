# File length and generated artifacts

`files/max-lines` uses two thresholds by default:

| Line count | Result |
| --- | --- |
| 0 through 500 | Pass |
| 501 through 1000 | Warning |
| 1001 or more | Error |

A file produces one line-count diagnostic at its highest applicable level.
LF and CRLF are supported, and a final newline does not add an extra line.
Binary files are skipped. A rule severity of `warning` or `info` caps the
diagnostic severity; `error` preserves both warning and error thresholds.

```yaml
rules:
  files/max-lines:
    severity: error
    options:
      warningLimit: 500
      limit: 1000
```

`limit` remains the error maximum for compatibility with existing settings.
`warningLimit` is the optional warning maximum. If the warning maximum is
greater than or equal to the error maximum, the warning interval is empty.
Both values must be non-negative integers. Path overrides can adjust either
threshold. `files/max-bytes` and `files/max-line-length` retain their separate
byte and character limits.

This repository uses the same 500/1000 configuration in its root `.qg.yaml`;
`just ci` runs it through the repository's full QG check.

## Shared artifact classification

Generated artifact patterns are registered once per scan and shared across
participating content rules. Built-in definitions cover:

- `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lock`, and `bun.lockb`, including nested package directories;
- `*.tsbuildinfo`;
- `*.min.js` and `*.min.css`;
- `*.map` source maps.

Add project-specific patterns in the **root** `.qg.yaml`:

```yaml
artifacts:
  generated:
    include: ["api/generated/**", "**/*.generated.ts"]
    exclude: ["api/generated/handwritten.ts"]
```

Patterns use `/` and are relative to the QG root. `include` adds to built-in
and extension registrations. `exclude` wins over all registrations and marks
matching files as source files for normal checking. Set `defaults: false`
to disable only the built-in registrations; project and extension patterns
still apply. Nested QG files cannot declare `artifacts`.

The repository marks package tarballs (`**/*.tgz`) as generated and relies on
the shared defaults for lockfiles and TypeScript build state. Its file-limit
configuration no longer repeats those exclusions for each rule.

The following built-in content checks skip generated files:

- byte, line-length, and line-count limits;
- document-reference, Markdown-character, and suppression-reason checks;
- the JavaScript `@ts-check` requirement;
- test fixture-copy checks;
- opt-in Biome, Prettier, and ESLint integrations.

The directory file-count rule also excludes generated entries from its count;
its `includeGenerated` option counts them when explicitly enabled.

External adapters skip generated input before resolving or launching tools.
Artifact classification does not remove files from the filesystem, changes,
or nearby-file discovery. References to generated targets remain valid, and
generated configuration/lockfiles still participate in external-tool cache
fingerprints. Targeted repository, package-manager, required-companion, and
Git integrity policies remain active; classifying a lockfile as generated does
not waive checks about choosing the correct package manager or keeping a
lockfile current.

To check a generated file with one content rule, use `includeGenerated: true`:

```yaml
overrides:
  - files: ["api/generated/public.ts"]
    rules:
      files/max-lines:
        severity: error
        options:
          includeGenerated: true
```

This bypasses only artifact classification for that rule. Explicit
`ignoredPaths`, `ignoredDirectories`, extensions, tool-native ignores, and
disabled rule settings still apply.

## Registering artifacts from external rules or plugins

Core exports `GeneratedArtifactDefinition`, `GeneratedArtifactRegistry`,
`GeneratedArtifactRuleOptions`, and the `GeneratedArtifacts` query interface.
A rule package can contribute patterns through its metadata:

```ts
const metadata = {
  // Other required RuleMetadata fields omitted here.
  id: "example/check-schema",
  generatedArtifacts: [
    {
      id: "example/schema-output",
      files: ["**/*.generated.ts", "schema/client/**"],
      excludedFiles: ["schema/client/manual.ts"],
      description: "Output produced by the schema generator.",
    },
  ],
};
```

The runner gathers contributions from **all supplied rules before any check
executes**, including disabled rules. Registration does not start a process
or enable the contributing rule. Identical IDs and definitions are deduplicated;
conflicting definitions with the same ID fail clearly. Use a package-specific
ID to avoid collisions. A definition's `excludedFiles` limits that definition
only; project `artifacts.generated.exclude` overrides every definition.

An embedding application can supply additional registrations with
`runQualityGate({ ...options, generatedArtifacts: definitions })`. An external content
rule opts into the shared exclusion policy with
`metadata.ignoreGeneratedArtifacts: true`. Its check should call
`context.resolveConfig(path)` and skip a path when `enabled` is false **before
reading content or launching a tool**. The runner applies the same policy to
returned diagnostics as a final filter. Rules verifying artifact integrity
can leave this metadata flag unset.

`context.artifacts.isGenerated(path)` exposes classification, and
`context.artifacts.matching(path)` returns matching definitions for explanations
or specialized behavior. These queries do not grant permission to skip an
explicitly enabled `includeGenerated` check; use `resolveConfig` for ordinary
content eligibility. Custom rule option types can extend
`GeneratedArtifactRuleOptions` to expose the shared opt-in with TypeScript.

The registry snapshots contributions and memoizes classifications within one
scan. Each daemon request builds a fresh registry and reloads project settings,
so classification changes do not require clearing rule caches. Registration
uses filename patterns; applications needing content-aware discovery can
compute registrations before calling the runner. The CLI currently loads its
built-in recommended rule set; dynamic external plugin loading is still future
work. Plugin hosts passing external `Rule` objects already use this contract.
