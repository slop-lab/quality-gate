# @slop-lab/qg-check-runner

Shared command and Node test checks for QG, independent of the CLI. This
package owns sequential execution, failure diagnostics, Node file-pattern
expansion and the concise test reporter. Its only runtime dependency is core.
Requires Node.js 24 or later.

```sh
npm install --save-dev @slop-lab/qg-check-runner
```

```ts
import { runChecks, type CheckConfig } from "@slop-lab/qg-check-runner";

const checks: CheckConfig[] = [
  { name: "build", command: "node", args: ["scripts/build.mjs"] },
  { name: "tests", type: "node-test", files: ["test/**/*.test.mjs"] },
];
const diagnostics = await runChecks(process.cwd(), checks);
if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
  process.exitCode = 1;
}
```

`runChecks(root, checks, processProvider?)` runs declarations in order, collects
all failures, and returns diagnostics without printing status or exiting.
Failed checks retain command output or execution errors in metadata. Commands
receive arguments directly without a shell. Both check types support timeout
(default 120000 ms) and recovery-message settings. Checks use the working tree;
index-aware rules are executed separately through core's `runQualityGate`.

For independent Node invocation preparation, this package also exports
`createNodeTestCommand(root, check)` and `NodeTestCheckConfig`. The function
returns command, arguments and environment fields for a process provider. It
expands/deduplicates file patterns and throws for unmatched patterns, uses the
current Node executable and packaged reporter, and clears `NODE_TEST_CONTEXT`
to isolate nested test runners. Callers own execution, timeout and output.

The reporter has a public subpath in the same package:

```sh
node --test --test-reporter=@slop-lab/qg-check-runner/node-test-reporter
```

It prints `PASS` for successful runs and details for failed tests, omitting
passing test names/counts. Failure context survives linked temporary paths.
The runner captures reporter output; CLI rendering remains in the CLI package.
