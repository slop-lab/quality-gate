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
use command preparation and reporting from `@slop-lab/qg-check-node-test`. Unmatched test patterns fail. The reporter
is also exposed at `@slop-lab/qg-check-node-test/reporter` for direct `node --test`
usage after installing the Node adapter in the consuming project.

The shared `CheckConfig` schema is defined by core's `QualityGateConfig` and
re-exported from the check runner. Core has no dependency on the check runner,
CLI, rule packages, parsers or spelling dictionaries. Check execution uses the
working tree; staged rules independently use the index snapshot.

The runner owns execution order, process failures and diagnostic formatting data.
The Node adapter owns file patterns, Node arguments and the reporter; it also
exports `createNodeTestCommand` and `NodeTestCheckConfig` for independent use.
Neither package depends on CLI output handling or the rule packages.
