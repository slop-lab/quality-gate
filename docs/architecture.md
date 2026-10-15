# Architecture

Quality Gate has one execution model with multiple entrypoints:

- CLI for local and CI usage.
- Workspace server for editor, agent, or MCP-style usage.
- Library API for embedding in other tools.

The runner should treat changed scans and full scans as different scopes over the same rule engine, not as separate systems.

## Scan Modes

### Changed Scan

A changed scan evaluates only the files, directories, or packages affected by a Git change set.

Default behavior:

- Compare `HEAD` against the merge base of the configured base ref.
- Include working tree changes when requested.
- Preserve Git status information such as added, modified, deleted, renamed, type-changed, and mode-changed.

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

The runner builds a `ScanContext` before invoking rules. The context exposes stable inputs instead of letting plugins shell out freely.

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

## Workspace Server

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

Cache layers:

- Git cache: merge base, status, file object IDs, rename information.
- Filesystem cache: file metadata, content hashes, directory listings.
- Project graph cache: package roots, workspace manifests, tsconfig/go module metadata.
- Plugin cache: parsed ASTs, dependency graphs, language server results, or tool output.

Cache keys must include:

- workspace ID;
- scan mode;
- config hash;
- plugin identity and version;
- rule options hash;
- relevant file content hashes or Git object IDs;
- relevant environment fingerprints when a plugin depends on external tools.

Cache invalidation should be explicit. The runner decides when a cache entry is stale based on file system changes, Git changes, config changes, plugin changes, and dependency changes.

Persistent cache layout should separate workspaces:

```text
.local/
  cache/
    quality-gate/
      daemon.sock
      rules/
        <rule-id>.json
```

Global cache entries are allowed only for immutable package artifacts, such as downloaded plugin metadata or compiled plugin bundles. Rule diagnostics, parsed project state, and external tool output must be workspace-scoped.

Emergency cache recovery supports invalidation by rule:

- rule;

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

The same result model should support terminal output, JSON, SARIF, GitHub annotations, and MCP responses.

## Rule Execution

The runner is responsible for:

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

Rules should not directly mutate files. Fixes are represented as suggestions or structured edits, and the runner applies them only when explicitly requested.

## Monorepo Behavior

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
