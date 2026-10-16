# Required files and nearby-file detection

The recommended rules include two repository requirements, enabled as errors:

- `repo/require-readme`: require a file named exactly `README.md` at the QG root.
- `repo/require-gitattributes`: require root `.gitattributes` with a universal
  `text=auto eol=lf` baseline.

The QG root is the CLI's `--root` directory, or the current directory by default.
Nested README files do not satisfy the root requirement. Directories with the
required filenames do not count as files. README contents may be empty; other
rules can enforce content policies independently.

Use this `.gitattributes` baseline:

```gitattributes
* text=auto eol=lf
```

The rule accepts reordered attributes, whitespace, separate universal
declarations, and attribute macros. It checks `*`, `**`, and `**/*` universal
patterns, including their directly quoted forms. Later universal assignments
can invalidate the baseline, including `-text`, `!text`, `binary`, or
`eol=crlf`. A commented-out declaration does not count. Git has no trailing
inline-comment syntax for attribute lines; invalid attribute tokens invalidate
that declaration. See [Git attributes](https://git-scm.com/docs/gitattributes).

Path-specific exceptions such as `*.png -text` and `*.bat eol=crlf` are allowed.
This checks the declared root baseline, not the effective attributes of every
file, nested `.gitattributes`, or local/global Git attribute configuration.
Patterns outside the listed universal forms are treated as path-specific.

Both root requirements run in full and changed scans, even if neither root
file is changed. This catches missing files on new repositories and staged
deletions. Staged checks use index filenames and contents, so unstaged fixes do
not satisfy them. The rules do not create or rewrite files. Configure severity
or disable them using normal rule configuration:

```yaml
rules:
  repo/require-readme: warning
  repo/require-gitattributes: error
```

## Conditional companion requirements

`files/required-companions` is available through the CLI and is off by default.
Enable it to declare additional policies based on nearby files:

```yaml
rules:
  files/required-companions:
    severity: error
    options:
      directories: ["packages/*"]
      policies:
        - when:
            anyOf: ["package.json", "Cargo.toml"]
          files: ["README.md"]
        - when:
            allOf: ["tsconfig.json", "package.json"]
            noneOf: ["PRIVATE"]
          files: ["LICENSE"]
```

Only directories matching `directories` are checked. Each matching policy
requires the listed literal filenames in that directory. File requirements
are deduplicated if multiple policies require the same file. The example
requires package README files without imposing them on unrelated directories;
it additionally requires a license when both TypeScript and package manifests
exist and the `PRIVATE` marker is absent.

| Option | Default | Meaning |
| --- | --- | --- |
| `policies` | `[]` | Conditions and required companion filenames. |
| `directories` | `["**"]` | Root-relative directory globs; `.` is the root. |
| `ignoredDirectories` | `.git`, `.local`, `.qg`, `node_modules`, `dist` | Directory names skipped during discovery. |

Nested QG configuration and directory overrides can replace these options.
Option globs remain relative to the QG root; configure policies with directory
patterns such as `packages/**`, rather than a pattern for one target filename.
Per-target rule settings can disable or change severity for individual missing
files. Full scans discover all eligible directories. Changed scans check the
root and affected directories plus their ancestors, including deleted paths
and old rename locations. Removed directories are skipped. Use a full scan
after configuration changes to check untouched packages too.

## Shared discovery contract

Core exports `FilePresenceCondition`, `FileDiscovery`, and
`NearbyFileDiscovery`. The runner supplies `context.discovery` to every rule.
Both companion policies and automatic rule gates use the same condition type:

| Field | Meaning |
| --- | --- |
| `allOf` | Every filename glob must match a file. |
| `anyOf` | At least one glob must match when supplied; an empty list never matches. |
| `noneOf` | No glob may match a file. |
| `search` | `directory` by default; `ancestors` also searches parents up to the QG root. |

All supplied conditions must hold. Patterns match filenames, such as
`package.json`, `biome*.json`, or `*.csproj`, rather than paths. Searches are
case-sensitive and directories do not count as marker files. With ancestor
search, matches can come from different directories along the ancestor chain;
a forbidden marker in any searched directory rejects the condition. No search
walks above the QG root. An empty condition matches unconditionally.

Rule authors can use the shared API for individual paths:

```ts
const project = await context.discovery.findNearest(
  ["package.json", "Cargo.toml"],
  "packages/app/src",
);
// Returns the nearest matching { directory, paths }, or undefined.

const applies = await context.discovery.matches(
  { allOf: ["package.json"], search: "ancestors" },
  "packages/app/src",
);
```

The second argument is a project-relative directory; callers with a file path
should pass its parent directory. `findNearest` returns only matches from the
nearest matching directory. Neither method follows a different working-tree
view during staged checks.

A rule can also declare `metadata.when`, using the same condition object.
The runner evaluates this gate at the root before calling `check`; a false
condition skips execution entirely. It does not enable an off rule or replace
normal project configuration. Existing pnpm rules use this mechanism to run
only when the appropriate workspace and lock files exist. Rules needing a
different condition per file or package should call `context.discovery`
within their checks, as the companion rule does.

Directory listings are loaded lazily and shared across rules within one scan.
Each scan gets a fresh discovery instance, including checks served by the QG
daemon. Marker creation, deletion, or staging therefore changes applicability
on the next scan without clearing a persistent cache. External formatter and
linter adapters remain explicitly opt-in.
