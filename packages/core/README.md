# QG Core

`@slop-lab/qg-core` provides the QG rule runner, configuration resolution,
Git index and filesystem providers, process execution, and rule caches.
Requires Node.js 24 or later. Licensed under MIT.

Use `runQualityGate` with rules supplied by your application or by
`@slop-lab/qg-rules-recommended`. Core does not load rules automatically.

See the [architecture](https://github.com/slop-lab/quality-gate/blob/main/docs/architecture.md)
and [rule contract](https://github.com/slop-lab/quality-gate/blob/main/docs/plugin-contract.md).
