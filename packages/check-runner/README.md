# QG check runner

`@slop-lab/qg-check-runner` runs command and Node.js test checks independently of the
CLI. It depends on core and `@slop-lab/qg-check-node-test`, and requires Node.js 24 or later.
The CLI uses this same runner for direct commands and pre-commit hooks.

```sh
npm install --save-dev @slop-lab/qg-check-runner
```

```ts
import { runChecks, type CheckConfig } from "@slop-lab/qg-check-runner";

const checks: CheckConfig[] = [
  { name: "typecheck", command: "node", args: ["scripts/typecheck.mjs"] },
  { name: "tests", type: "node-test", files: ["test/**/*.test.mjs"] },
];
const diagnostics = await runChecks(process.cwd(), checks);
if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
  process.exitCode = 1;
}
```

`runChecks(root, checks, processProvider?)` returns `Promise<Diagnostic[]>`.
It prints no status or CLI output. It runs declarations sequentially, collects
all failures, and retains stdout/stderr or execution errors in diagnostic
metadata. A custom `ProcessProvider` can be passed as the third argument.

Command checks pass arguments directly without a shell. Node test checks expand
and deduplicate file globs relative to `root`, fail on unmatched patterns, and
delegate command preparation and reporting to `qg-check-node-test`. Both types support
`timeoutMs` (default 120000) and recovery `message`.
Checks execute against the working tree; index-aware rules are run separately
by `runQualityGate` from core. Library callers can compose both result sets.
The shared configuration type also remains available from core so configuration
consumers share one schema.

The Node adapter owns the reporter. Install `@slop-lab/qg-check-node-test`
explicitly to use its public reporter entry point:

```sh
node --test --test-reporter=@slop-lab/qg-check-node-test/reporter
```

It prints `PASS` for successful runs and failure details for failed tests,
without passing test lists or counts. The runner captures these details for
its returned diagnostics; the CLI owns final text/JSON rendering.
