# Checks as a library

Use `@slop-lab/qg-core` for rules and `@slop-lab/qg-check-runner` for command and Node
checks. The CLI composes these APIs and owns hook setup, configuration loading,
text/JSON output and exit status. Both execution packages work without the CLI.

```ts
import { runQualityGate } from "@slop-lab/qg-core";
import { runChecks, type CheckConfig } from "@slop-lab/qg-check-runner";

const checks: CheckConfig[] = [
  { name: "build", command: "node", args: ["scripts/build.mjs"] },
  { name: "tests", type: "node-test", files: ["test/**/*.test.mjs"] },
];
const result = await runQualityGate({ root, rules, config, mode: "full" });
result.diagnostics.push(...await runChecks(root, checks));
```

`runChecks(root, checks, processProvider?)` returns diagnostics without printing
or exiting. It preserves declaration order and captures every failed check,
including missing executables, nonzero exits, and timeouts. Diagnostics use
`checks/<name>` IDs with command output in metadata. A custom `ProcessProvider`
can inject execution in tests or other environments. Both built-in check types
support timeout and recovery-message settings.

Node tests expand and deduplicate globs, use the current Node executable, and
load this package's reporter. Unmatched patterns fail. Use
`@slop-lab/qg-check-runner/node-test-reporter` for direct `node --test` reporter usage
in a project where this package is installed.

The package also exports `createNodeTestCommand(root, check)` and
`NodeTestCheckConfig` for callers that want to prepare a Node command and own
its execution. The helper returns command, arguments and environment fields;
it does not execute tests or set an exit status.

The shared `CheckConfig` schema remains in core and is re-exported from checks.
Core has no dependency on the check runner, CLI, rule packages, parsers or
spelling dictionaries. Check execution uses the working tree; staged rules
independently use the index snapshot. The CLI owns final rendering and status.
