# @slop-lab/qg-check-runner

Run QG command and test checks without the CLI. Requires Node.js 24 or later.

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

Install the adapter for each test type used by the project. Available packages
are `@slop-lab/qg-check-node-test`, `@slop-lab/qg-check-unittest`,
`@slop-lab/qg-check-jest`, `@slop-lab/qg-check-vitest`, and `@slop-lab/qg-check-cargo`.

`runChecks(root, checks, processProvider?)` runs declarations in order and
returns diagnostics for failed checks. Commands receive arguments directly.
Failures retain output or execution errors in metadata. All checks support
`cwd` relative to the root, `timeoutMs` (default 120000), and a recovery
`message`. Pass `await collectCheckArtifacts(root, checks)` as
`generatedArtifacts` when also running the core rule engine.
