# Plugin Contract

Plugins provide rules and optional input providers. A plugin should be portable across CLI and server usage.

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
- `optionsSchema`
- `fixable`: `none | suggestion | edit`
- `docsUrl`

Rule IDs are part of the public contract and should not be renamed casually.

## Useful Inputs

The runner may provide these inputs to plugins:

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

Inputs are lazy. A rule asks for data through the context API, and the runner decides whether to serve it from cache or compute it.

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

If a plugin starts an external service, such as a language server, it must declare lifecycle hooks and cache keys so the runner can restart it when config or dependency state changes.

## External Tools

Plugins may wrap existing tools, but they must declare:

- executable name;
- version requirement;
- config files used;
- whether output is cacheable;
- whether the tool supports changed-path filtering;
- whether the tool reads the whole project even for changed scans.

The runner should expose this in `quality-gate explain` so users understand why a scan is slow or why a rule is unavailable.

## Fixes

Fixes are optional and must be represented as structured edits.

Fix levels:

- `suggestion`: human-readable remediation only.
- `edit`: file edits that the runner can apply.

Rules must not delete files or modify directories directly. For example, `gitkeep/no-lone-gitkeep` may suggest deleting `.gitkeep`, but the runner applies the deletion only when `--fix` is requested and the rule is enabled for fixes.

