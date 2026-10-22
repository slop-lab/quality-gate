# @slop-lab/qg-check-node-test

Node.js test invocation preparation and a concise test reporter. This package
has no dependency on the CLI or check runner; its only runtime dependency is core.
It owns glob expansion, path deduplication, reporter location and isolation from
an enclosing Node test runner. Requires Node.js 24 or later.

```sh
npm install --save-dev @slop-lab/qg-check-node-test
node --test --test-reporter=@slop-lab/qg-check-node-test/reporter
```

```ts
import { createNodeTestCommand, type NodeTestCheckConfig } from "@slop-lab/qg-check-node-test";
import { NodeProcessProvider } from "@slop-lab/qg-core";

const check: NodeTestCheckConfig = {
  name: "tests", type: "node-test", files: ["test/**/*.test.mjs"],
};
const root = process.cwd();
const invocation = createNodeTestCommand(root, check);
const result = await new NodeProcessProvider().exec({ ...invocation, cwd: root });
```

`createNodeTestCommand` returns command, argument and environment fields.
It throws if a file pattern has no matches. Callers own execution, timeout,
output handling and exit status; use `qg-check-runner` to execute a shared list
of command and Node checks with consistent failure diagnostics.

The reporter prints `PASS` for successful runs, retains failed test details and
captured output, and omits passing names/counts. It matches linked and real file
paths so failure context survives symlinked temporary directories.
