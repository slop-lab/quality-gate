# Architecture

This document describes the current runner and the intended architecture.
The implemented entrypoints are the CLI, a single-project daemon, and the
`@slop-lab/qg-core` library API. General workspace servers, dynamic plugin
loading, package graphs, and additional output formats remain design goals.
See [CLI](cli.md) for the supported commands and options.

The target architecture has one execution model with multiple entrypoints:

- CLI for local and CI usage.
- Workspace server for editor, agent, or MCP-style usage.
- Library API for embedding in other tools.

The runner should treat changed scans and full scans as different scopes over the same rule engine, not as separate systems.

## Scan Modes

### Changed Scan

A changed scan evaluates only the files, directories, or packages affected by a Git change set.

Current CLI behavior:

- By default, inspect staged changes and read rule filesystem inputs from the Git index.
- With `--changed --base <ref>`, compare the head ref (default `HEAD`) against the merge base of the base ref and read working tree contents.
- With `--working-tree`, inspect unstaged tracked changes against the index.
- Normalize added, modified, deleted, renamed, copied, type-changed, and unmerged statuses. The status type also reserves mode-changed and unknown values.

Without an explicit or configured base, a ref comparison uses `HEAD...HEAD`.
Configuration files are loaded from the working tree even during staged scans.

Changed scans are the default for interactive workflows because they are fast and match the actual implementation surface.

### Full Scan

A full scan evaluates the current workspace snapshot.

Full scans are used for:

- scheduled CI jobs;
- release gates;
- baseline generation;
- verifying that repository-wide invariants still hold;
- validating plugins whose behavior depends on global state.

Rules must declare whether they support `changed`, `full`, or both. A rule that needs full repository context may still run during a changed scan if it can narrow its work from the affected paths.

## Scope Model

The runner builds a `RuleContext` before invoking each rule. It exposes changes,
filesystem and process providers, resolved options, path-specific configuration,
and a rule cache. Scope is rule metadata; rules currently traverse their own
inputs. Central package discovery and scope scheduling are future work.

Core scopes:

- `file`: one file path and optional content.
- `directory`: a directory affected by changed files.
- `package`: a monorepo package or workspace inferred from project manifests.
- `repo`: repository-level metadata.

Rules declare the narrowest scope they need. This allows the runner to cache aggressively and avoid unnecessary filesystem reads.

## Git Input Model

Git changes are normalized into `ChangeEntry` records.

Fields:

- `status`: `added | modified | deleted | renamed | copied | type_changed | mode_changed | unmerged | unknown`
- `path`: current path when present
- `oldPath`: previous path for renamed or copied files
- `mode`: optional Git file mode metadata
- `similarity`: optional rename/copy similarity score

Deleted paths remain important because they can affect directory-level rules. For example, removing the last real file from a directory can make a `.gitkeep` rule fail.

## Workspace Server (Planned)

The current `daemon` command runs one project per process and supports check,
ping, and stop requests. On Windows it uses a named pipe whose name contains
a hash of the resolved, case-normalized project path. Other platforms use
`.local/cache/qg/daemon.sock`. Windows pipe names are independent of
project path length and do not create a socket file in the cache directory.
Requests are newline-delimited JSON; each connection carries one request and
one JSON response. The server closes the connection after responding, so
request framing does not depend on half-closing a named pipe.
It does not implement workspace registration or the identity protocol below.

The server owns one or more persistent workspaces. A workspace is identified by:

- repository root;
- config file path and hash;
- plugin set and plugin versions;
- lockfile or dependency snapshot when relevant.

The initial implementation should support one workspace per server process. Multi-workspace support should be designed into the cache keys and protocol so it can be added without changing plugin APIs.

Workspace identity should be stable and explicit:

- `workspaceId`: caller-provided ID when available;
- `root`: canonical absolute repository root;
- `vcsRoot`: canonical absolute Git root;
- `configPath`: canonical config file path;
- `configHash`: hash of effective config;
- `pluginSetHash`: hash of plugin names, versions, and resolved entrypoints.

If the caller does not provide `workspaceId`, the server derives one from `root`, `configPath`, and `pluginSetHash`. Derived IDs are suitable for local use but should not be exposed as long-term API identifiers.

The server should expose operations equivalent to:

- initialize workspace;
- list workspaces;
- remove workspace;
- compute changed set;
- run changed scan;
- run full scan;
- explain active config;
- list rules;
- invalidate cache;
- shutdown workspace.

## Cache Model

Cached values and their refresh policy are owned by each rule. Core provides
rule-isolated namespaces, content-addressed key helpers, and atomic persistent
storage. This lets a document rule cache parsed references and dependency
graphs without coupling their invalidation semantics to the runner.

Potential future cache layers:

- Git cache: merge base, status, file object IDs, rename information.
- Filesystem cache: file metadata, content hashes, directory listings.
- Project graph cache: package roots, workspace manifests, tsconfig/go module metadata.
- Plugin cache: parsed ASTs, dependency graphs, language server results, or tool output.

Rules must include inputs that affect their cached values in their keys.
Depending on the rule and future server capabilities, these may include:

- workspace ID;
- scan mode;
- config hash;
- plugin identity and version;
- rule options hash;
- relevant file content hashes or Git object IDs;
- relevant environment fingerprints when a plugin depends on external tools.

Cache invalidation is rule-owned. The runner supplies a cache namespace but
does not decide whether individual values are stale. Rules must validate
relevant content, options, and dependencies before reusing cached values.
The CLI supplies persistent storage through the daemon; standalone checks use
a no-op cache store.

Persistent cache layout separates workspaces under each project root (the
socket file is only present on platforms using Unix-domain sockets):

```text
.local/
  cache/
    qg/
      daemon.sock
      rules/
        <sanitized-rule-id>.json
```

Global cache entries are allowed only for immutable package artifacts, such as downloaded plugin metadata or compiled plugin bundles. Rule diagnostics, parsed project state, and external tool output must be workspace-scoped.

For example, `docs/valid-reference` is stored in `docs__valid-reference.json`.
Emergency recovery uses `qg cache clear --rule <rule-id>`.

Watch mode may update caches incrementally, but correctness must not depend on file watching. A scan after missed filesystem events must still become correct by validating hashes and metadata.

## Result Model

Rules return diagnostics. Output format conversion is handled outside the rule.

Diagnostic fields:

- `ruleId`
- `severity`: `error | warning | info`
- `message`
- `path`
- `line`
- `column`
- `endLine`
- `endColumn`
- `scope`: `file | directory | package | repo`
- `suggestedFix`
- `docsUrl`
- `metadata`

The current CLI supports terminal output and JSON. SARIF, GitHub annotations,
and MCP responses are planned consumers of the same result model.

## Rule Execution

The current core runner computes scan inputs, resolves rule configuration,
executes enabled rules sequentially, and collects diagnostics. The CLI loads
YAML configuration, supplies built-in rules, formats output, and determines
the exit status.

The target runner and entrypoints are responsible for:

- loading config;
- resolving plugins;
- computing scan inputs;
- applying include/exclude filters;
- scheduling rule execution;
- enforcing timeouts;
- collecting diagnostics;
- formatting output;
- deciding process exit status.

Rules are responsible for:

- declaring required inputs;
- performing deterministic checks;
- returning diagnostics;
- avoiding hidden global side effects.

Rules should not directly mutate files. Fixes can be represented as suggestions
or structured edits. Applying edits is planned; the current runner does not
apply fixes.

## Monorepo Behavior (Planned)

Current configuration supports nested YAML files and path-based overrides.
Central package graph discovery and package-based overrides are not implemented.

The runner should understand package boundaries but must not require one package manager.

Package discovery should support:

- `package.json` workspaces;
- `pnpm-workspace.yaml`;
- `lerna.json`;
- `turbo.json`;
- `go.work`;
- `go.mod`;
- explicit config-defined packages.

Project-level overrides apply by path or package. The runner should be able to answer why a rule is active for a path.
