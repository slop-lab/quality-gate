# File names, paths, and custom policies

The language-independent recommended set includes `files/allowed-name` and
`files/allowed-path`. Both are disabled until enabled in configuration. They
inspect file names without reading file contents.

```yaml
rules:
  files/allowed-name:
    severity: error
    message: "Use lowercase words separated by hyphens for source filenames."
    options:
      files: ["src/**/*.ts"]
      allowedPatterns: ['[a-z]+(-[a-z]+)*(\.test)?\.ts']
  files/allowed-path:
    severity: error
    options:
      files: ["features/**/*.ts"]
      allowedPatterns: ['features/[a-z-]+/(index|[a-z-]+)\.ts']
      ignoredPaths: ["features/legacy/**"]
```

`files/allowed-name` matches the basename, including the extension.
`files/allowed-path` matches the complete root-relative path, using `/` on all
platforms. Regular expressions must match the entire value; any one pattern
may match. An empty `allowedPatterns` list rejects every selected file. Invalid
expressions fail with a configuration error when the selected files are checked.
Use YAML single quotes to preserve regular-expression backslashes.

Both rules accept:

| Option | Default | Meaning |
| --- | --- | --- |
| `allowedPatterns` | `[]` | Allowed regular expressions, matched against the entire value. |
| `files` | `["**"]` | Root-relative globs selecting files to check. |
| `ignoredPaths` | `[]` | Root-relative globs excluding files. |
| `ignoredDirectories` | `.git`, `.local`, `.qg`, `node_modules`, `dist` | Directory names skipped during discovery and validation. |

Full scans discover files under the root. Changed scans inspect changed files,
including rename/copy destinations, and skip deletions. Staged scans use the
Git index, so an unstaged rename cannot hide a staged naming violation. Symlinks
are not traversed in full scans. The root `ignoredDirectories` controls full-scan
traversal; remove a directory name there to inspect its contents.

Normal rule overrides, nested configuration, severity, and recovery `message`
apply. Naming and layout policies also inspect generated files outside ignored
directories; generated-content exemptions do not waive path integrity policies.
Use `ignoredPaths` to exempt generated names explicitly.

## Policies written in code

Use a custom rule when naming depends on parent directories, neighboring files,
or other project conventions. Install the helper package directly in the project:

```sh
npm install --save-dev @slop-lab/qg-core
```

Create `qg-rules.mjs`:

```js
import { createFilePathRule } from "@slop-lab/qg-core";

export const rules = [
  createFilePathRule({
    id: "project/feature-entry",
    name: "Feature entry filename",
    description: "Feature entry files must use their directory name.",
    defaultOptions: { files: ["features/*/*.ts"] },
    validate(path) {
      const parts = path.split("/");
      const directory = parts.at(-2);
      const filename = parts.at(-1);
      if (filename !== `${directory}.ts`) {
        return `Name the feature entry ${directory}.ts.`;
      }
    },
  }),
];
```

Load and enable it in the **root** `.qg.yaml`:

```yaml
ruleModules: ["./qg-rules.mjs"]
rules:
  project/feature-entry:
    severity: error
    message: "The entry filename must match the feature directory."
```

This accepts `features/cart/cart.ts` and rejects `features/cart/index.ts`.
Run `qg`, `qg check --full`, or `qg run-hook pre-commit` as usual. Use
`qg rules` to inspect loaded rule IDs.

`createFilePathRule` creates an opt-in `Rule`. It owns file discovery, changed
and staged handling, selection/ignore globs, and per-file option resolution.
`validate(path, context)` receives a root-relative `/` path and the normal
`RuleContext`, with `context.options` and `context.severity` resolved for that
file. Return an error message for a violation, or `undefined` when valid.
The callback may be async and use `context.fs` or `context.discovery` for
neighbor-dependent policies. Declare additional required inputs with
`requires`, for example `requires: ["fileContent"]` when reading file contents.
Set `recheckOnChanges` to root-relative input globs, such as `["package.json"]`,
to recheck every selected file when shared metadata changes in changed mode.
This supports policies comparing workspace manifests with a root release.
The helper lives in dependency-free core, so custom path policies do not install
the Markdown parser from the file-rule package. The helper never renames or writes files. Custom options can be supplied through
`defaultOptions`, rule `options`, and normal overrides, alongside `files`,
`ignoredPaths`, and `ignoredDirectories`.

`ruleModules` also accepts installed package names such as `@your-org/qg-rules`.
Local paths resolve relative to the QG project root; packages resolve from that
project's dependencies. Modules must export a named `rules` array or a default
rule array. Ordinary `Rule` objects are supported too; the helper is optional.
Modules may instead export a `ruleProvider` for custom execution strategies.
See [rule execution providers](rule-providers.md) for public types and subprocess
or daemon examples. Missing modules, malformed rules, and duplicate IDs fail explicitly. Repeating
the same module specifier loads it once. Modules load from the working tree,
like configuration files. With a persistent daemon, restart it after changing
custom rule implementation code or its imports.

Use `@slop-lab/qg-rule-test-utils` to test custom rules. See the
[test utility guide](../packages/rule-test-utils/README.md).
