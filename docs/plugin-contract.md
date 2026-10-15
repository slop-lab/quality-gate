# Plugin Contract

Plugins provide rules and optional input providers. A plugin should be portable across CLI and server usage.

This document combines the current rule interface with future plugin design
requirements. Today, library callers pass `Rule` objects and injectable
providers to `runQualityGate`; the CLI loads its default set from the separate
`@slop-lab/qg-rules-recommended` package. Core does not depend on rule packages.
Dynamic plugin loading, lifecycle hooks, rich input discovery, and automatic
fix application are not implemented.

## Principles

Plugins must be:

- deterministic for the same inputs;
- explicit about required scope and expensive inputs;
- safe to run repeatedly in a persistent process;
- compatible with changed scans and full scans when declared;
- isolated from unrelated workspaces;
- clear about external tool dependencies;
- conservative with automatic fixes.

Plugins should not:

- shell out to Git when the runner already provides Git data;
- maintain unbounded global caches;
- read arbitrary repository files without declaring the need;
- write files directly during normal checks;
- depend on wall-clock time, network calls, or host-specific state unless explicitly configured.

## Rule Metadata

Each rule declares:

- `id`: stable rule ID, such as `gitkeep/no-lone-gitkeep`
- `name`
- `description`
- `defaultSeverity`
- `supports`: `changed`, `full`, or both
- `scope`: `file`, `directory`, `package`, or `repo`
- `requires`: requested inputs
- `defaultOptions` (optional)
- `fixable`: `none | suggestion | edit`
- `docsUrl` (optional)

Runtime option schemas are a future extension; `RuleMetadata` does not
currently expose an `optionsSchema` field.

Rule IDs are part of the public contract and should not be renamed casually.

## Useful Inputs

The current `RuleContext` provides normalized changes, filesystem and process
providers, scan mode, resolved options and severity, path-specific config
resolution, and a rule-owned cache. Filesystem reads use the index during
staged CLI checks and the working tree otherwise.

The target input model may additionally provide:

- normalized Git changes;
- current file content;
- previous file content for changed paths;
- file metadata and content hash;
- directory listings;
- package graph;
- dependency manifests;
- language config files such as `tsconfig.json`;
- ignore rules and effective include/exclude filters;
- baseline diagnostics;
- changed lines when available;
- user-selected scan mode;
- CI metadata when explicitly enabled.

Filesystem reads are requested through the context API. Rules currently decide
what to cache and when to refresh it; richer runner-managed input caching is
future work.

## Changed Scan Rules

Changed-scan rules must be clear about what "affected" means.

Examples:

- File rule: inspect only added or modified files matching the rule pattern.
- Directory rule: inspect directories containing changed files, deleted files, or renamed file endpoints.
- Package rule: inspect packages containing changed files.
- Repo rule: inspect repository-level metadata only when a changed path can affect that metadata.

The `gitkeep/no-lone-gitkeep` rule is a directory rule. It must inspect directories affected by added, modified, deleted, or renamed paths and report when a directory contains only `.gitkeep`.

## Full Scan Rules

Full-scan rules should operate over the entire configured include set. They may reuse the same scope model:

- file rules iterate over matched files;
- directory rules iterate over matched directories;
- package rules iterate over discovered packages;
- repo rules run once per workspace.

Full scan support is important for scheduled validation and for catching pre-existing issues that are outside the current change set.

## Persistent Workspace Rules

Plugins must assume they may run in a long-lived process.

Requirements:

- no process-wide mutable state unless keyed by workspace and config hash;
- cleanup hooks for expensive resources;
- bounded memory usage;
- no stale diagnostics after files change;
- no reliance on current working directory after initialization;
- no mutation of shared objects from the runner.

Future support for plugins that start external services, such as language
servers, will require lifecycle hooks and cache keys so the runner can restart
them when config or dependency state changes. The current rule interface has
no lifecycle hooks.

## External Tools

Plugins may wrap existing tools, but they must declare:

- executable name;
- version requirement;
- config files used;
- whether output is cacheable;
- whether the tool supports changed-path filtering;
- whether the tool reads the whole project even for changed scans.

A future `qg explain` command should expose this so users understand
why a scan is slow or why a rule is unavailable. That command and structured
external-tool metadata are not currently implemented.

## Fixes

Fixes are optional and must be represented as structured edits.

Fix levels:

- `suggestion`: human-readable remediation only.
- `edit`: file edits that the runner can apply.

Rules must not delete files or modify directories directly. For example,
`gitkeep/no-lone-gitkeep` can suggest deleting `.gitkeep`. The current runner
only returns the suggestion; a future fix implementation must require an
explicit request and rule opt-in before applying edits. The CLI has no `--fix`
option today.
