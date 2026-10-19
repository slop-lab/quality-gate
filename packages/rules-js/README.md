# QG JavaScript Rules

`@slop-lab/qg-rules-js` exports `jsRules` and each individual rule. The
recommended QG rule set includes these rules. External adapters require explicit
opt-in; the JavaScript and package manager checks are enabled by default.

- `js/require-ts-check`: require an effective leading `// @ts-check` directive.
- `package-manager/no-npm-lock-with-pnpm`: reject npm lockfiles in pnpm workspaces.
- `package/allowed-name`: opt-in package name allowlist (see below).
- `pnpm/lockfile-is-current`: check that pnpm would leave its lockfile unchanged.
- `external/biome`, `external/prettier`, `external/eslint`: optional read-only
  integrations with project-installed formatters and linters. See
  [external tools](../../docs/external-tools.md) for setup, snapshots, daemon
  support, and cache behavior.

The JavaScript check inspects `.js`, `.jsx`, `.mjs`, and `.cjs` files in changed
or full scans. It accepts leading whitespace, copyright comments, a BOM, and
a shebang before the directive. A shebang must start at the very first byte;
a BOM or whitespace before it prevents TypeScript from recognizing the header.
Strings, block-comment directives, and comments
after executable code do not enable checking. The last leading `@ts-check` or
`@ts-nocheck` directive wins, matching TypeScript. A project's `checkJs` setting
does not waive the requirement for a file-level directive.

```js
// @ts-check
export const answer = 42;
```

Configure generated or vendored files with `.qg.yaml`:

```yaml
rules:
  js/require-ts-check:
    severity: error
    options:
      ignoredPaths: ["vendor/**", "**/*.min.js"]
```

`extensions` and `ignoredDirectories` can override their defaults. By default,
`.git`, `.local`, `.qg`, `node_modules`, and `dist` are excluded. Nested project
configuration can override severity, options, or disable the rule by path.
Staged scans inspect index contents, including partial staging.
Content checks skip [registered generated artifacts](../../docs/generated-artifacts.md)
unless `includeGenerated: true` is set. Package-manager integrity checks still
validate the relevant lockfiles.

Enable `package/allowed-name` to restrict the `name` field of root and nested
`package.json` files. Each `allowedPatterns` entry is a regular expression
matched against the entire name; any matching pattern passes. Missing, empty,
or non-string names and malformed JSON are reported. An empty allowlist rejects
all names. This rule is disabled by default.

```yaml
rules:
  package/allowed-name:
    severity: error
    options:
      allowedPatterns: ["@slop-lab/qg(-.*)?", "@this-project/[^/]+"]
```

Changed scans check added, modified, copied, and renamed manifests; full scans
check all manifests. `ignoredPaths`, `ignoredDirectories`, path overrides,
generated artifact exclusions, and staged index contents work as for
`js/require-ts-check`.
