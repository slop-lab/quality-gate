# Custom rule execution providers

A custom module can export a rule array or a `ruleProvider`. Providers separate
rule discovery from execution and can use an in-process function, subprocess,
HTTP daemon, socket, or another transport. QG adapts discovered metadata into
ordinary rules, retaining configuration, severity, recovery messages, overrides,
and staged/full scan behavior.

Install the public interfaces in a consuming project:

```sh
npm install --save-dev @slop-lab/qg-core
```

The package root exports runtime helpers and TypeScript declarations:

```ts
import {
  createRuleProvider,
  createRulesFromProvider,
  type RuleProvider,
  type RuleExecutor,
  type RuleExecutionRequest,
  type RuleExecutionServices,
  type RuleExecutionResult,
  type RuleMetadata,
  type Diagnostic,
} from "@slop-lab/qg-core";
```

The contract supports typed rule options:

```ts
interface RuleExecutor<TOptions = unknown> {
  execute(
    request: RuleExecutionRequest<TOptions>,
    services: RuleExecutionServices<TOptions>,
  ): Promise<RuleExecutionResult>;
}

interface RuleProvider<TOptions = unknown> extends RuleExecutor<TOptions> {
  getRules():
    | readonly RuleMetadata<TOptions>[]
    | Promise<readonly RuleMetadata<TOptions>[]>;
}
```

`getRules()` supplies metadata with stable, unique IDs. `execute()` handles one
rule and returns `{ diagnostics: Diagnostic[] }`; an empty array means pass.
Every returned diagnostic identifies the requested rule. Invalid metadata,
duplicate IDs, malformed results, and thrown transport errors fail explicitly.

`request` contains `ruleId`, `root`, `mode`, `changes`, `options`, and `severity`.
Its options are resolved at the root; resolve each path through
`services.resolveConfig(path)` when applying per-file configuration. QG applies
severity, recovery messages, and normal diagnostic filtering to returned results.

`services` exposes `fs`, `process`, `resolveConfig`, `cache`, `discovery`, and
`artifacts`. These are live host capabilities and stay separate from execution
data. Read inputs through `services.fs` before sending them to another process or
machine: during staged scans this reads the Git index. A worker reading files
from `request.root` on its own would read the working tree instead. The provider
chooses which paths to inspect, how to encode inputs, and how to transport them.
Wire encoding, deadlines, connection management, and process cleanup belong to
the provider. The QG daemon and a provider's external daemon have independent
lifecycles.

## Node subprocess example

Create `qg-provider.mjs` in the consuming project:

```js
import { execPath } from "node:process";

async function inputFor(request, services) {
  let paths = request.options.paths;
  if (request.mode === "changed") {
    const changed = new Set(request.changes
      .filter((change) => change.status !== "deleted")
      .map((change) => change.path));
    paths = paths.filter((path) => changed.has(path));
  }
  const files = [];
  for (const path of paths) {
    const config = services.resolveConfig(path);
    if (!config.enabled || !(await services.fs.isFile(path))) continue;
    files.push({ path, content: await services.fs.readFile(path), config });
  }
  return { request, files };
}

/** @type {import('@slop-lab/qg-core').RuleProvider<{ paths: string[] }>} */
export const ruleProvider = {
  getRules() {
    return [{
      id: "project/no-debugger",
      name: "No debugger statements",
      description: "Example of a subprocess rule.",
      defaultSeverity: "error",
      defaultEnabled: false,
      supports: ["changed", "full"],
      scope: "file",
      requires: ["fileContent"],
      fixable: "none",
      defaultOptions: { paths: ["src/index.ts"] },
    }];
  },
  async execute(request, services) {
    const result = await services.process.exec({
      command: execPath,
      args: ["tools/custom-rule-worker.mjs"],
      cwd: request.root,
      input: JSON.stringify(await inputFor(request, services)),
      timeoutMs: 30000,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Custom rule worker failed.");
    }
    return JSON.parse(result.stdout);
  },
};
```

Create `tools/custom-rule-worker.mjs`:

```js
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { request, files } = JSON.parse(input);
const diagnostics = files
  .filter((file) => file.content.includes("debugger;"))
  .map((file) => ({
    ruleId: request.ruleId,
    severity: file.config.severity,
    scope: "file",
    path: file.path,
    message: "Remove the debugger statement.",
  }));
process.stdout.write(JSON.stringify({ diagnostics }));
```

The example uses one JSON document on stdin and stdout. The worker reserves
stdout for its response and writes logs to stderr. A worker may use any language
that implements the provider's chosen wire format. Rule violations return
structured diagnostics; execution failures throw.

Load and enable the provider in root `.qg.yaml`:

```yaml
ruleModules: ["./qg-provider.mjs"]
rules:
  project/no-debugger:
    severity: error
    options:
      paths: ["src/index.ts", "src/main.ts"]
```

`paths` in this example is a provider-specific list of literal paths. Projects
can implement different selection or use the
[`createFilePathRule` helper](file-paths.md#policies-written-in-code).
Run `qg`, `qg check --full`, or `qg run-hook pre-commit` as usual.

## Daemon execution

The same provider can replace `execute` with a request to an independently
managed daemon. Reuse `inputFor` above so the daemon receives the selected
snapshot and per-path settings:

```js
async function execute(request, services) {
  const response = await fetch("http://127.0.0.1:4319/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await inputFor(request, services)),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Rule daemon returned ${response.status}`);
  return response.json(); // { diagnostics: Diagnostic[] }
}
```

Assign this function to the provider's `execute` property. Its `getRules()` can
also discover metadata from that daemon. Other transports implement the same
`RuleExecutor` contract without changes to QG's rule runner.

## Library usage and existing rules

A module may export a named `ruleProvider` or a default provider object. Modules
with a rule array export named `rules` or a default array. When authoring an
installed package, expose the selected module through its package entrypoint
and list that package in `ruleModules`.

Library consumers adapt a provider explicitly:

```ts
const rules = await createRulesFromProvider(provider);
await runQualityGate({ root, rules, mode: "full" });
```

`createRuleProvider(existingRules)` exposes ordinary `Rule` objects through the
same discovery/execution contract. This also works with `createFilePathRule`.
The adapters retain host services and per-rule cache ownership; execution is
not memoized by the provider adapter. Providers used in a persistent QG daemon
must support repeated invocations. Restart that daemon after modifying module
implementation code or its imports.
