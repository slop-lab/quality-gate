# @slop-lab/qg-rule-stdin

Factory for QG rules that validate a file snapshot through a command's stdin.
It handles changed/full selection, generated-file exclusions, per-file settings,
local package executable discovery, version probing, timeouts and caching.
Its only runtime dependency is `@slop-lab/qg-core`.

It contains no built-in adapters, tool registry, or tool-specific argument and
output formats. Each adapter owns its protocol. The Biome, Prettier and ESLint
packages consume this same public API independently.

```sh
npm install --save-dev @slop-lab/qg-rule-stdin
```

```ts
import { createStdinRule, type StdinRuleOptions } from "@slop-lab/qg-rule-stdin";

export const rules = [createStdinRule<StdinRuleOptions>({
  id: "project/validator",
  name: "Project validator",
  description: "Validate snapshot text",
  packageName: "project-validator",
  binaryName: "project-validator",
  files: ["**/*.txt"],
  validateOptions(options) {
    if (options.args?.length) throw new Error("This protocol accepts no extra flags.");
  },
  args: (path) => ["--stdin", "--filename", path],
  diagnostics(path, _options, _input, result) {
    if (result.exitCode > 1) throw new Error(result.stderr || "Validator failed");
    return result.exitCode === 0 ? [] : [{
      ruleId: "project/validator", severity: "error", scope: "file",
      path, message: result.stderr || "Invalid text",
    }];
  },
})];
```

Load this module through QG's `ruleModules` and enable `project/validator`.
Custom option interfaces extend `StdinRuleOptions`; pass the interface as the
factory's type argument. `StdinRuleDefinition` describes the adapter contract.
A local package's JS bin runs under the current Node executable. If the package
is absent, `fallbackCommand` or `binaryName` is resolved from PATH. `command` and
`commandArgs` options override discovery. Commands must accept `--version`.

Adapters must validate unsafe/protocol-changing flags before executable discovery,
build their read-only arguments, and map valid command results to diagnostics.
Throw for execution and protocol errors; thrown results are never cached.
`validateStdinArgs(id, args)` is an optional helper rejecting common mutating and
stdin/report-format flags; each adapter remains responsible for its full protocol.

The factory defaults to a 30-second timeout and result caching. Cache inputs
include the rule ID, command/version, arguments, options, environment, snapshot
contents, project files outside ignored directories, and extra `cacheInputs`.
Configuration, executable packages and plugins are read from the working tree;
file contents come from QG's injected snapshot. The factory does not write files.
