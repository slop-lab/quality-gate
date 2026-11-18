# Checks as a library

Use `@slop-lab/qg-core` for rules and `@slop-lab/qg-check-runner` for command and
test checks. The CLI composes these APIs and owns hook setup, configuration
loading, output and exit status.

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
or exiting. It preserves check order and captures every failure, including
missing dependencies, nonzero exits, and timeouts. Diagnostics use
`checks/<name>` IDs with execution details in metadata. All checks support
`timeoutMs` and a recovery `message`. A custom `ProcessProvider` can inject
execution for tests.

Install test adapters in the project passed as `root`. The runner resolves
`@slop-lab/qg-check-<type>` for each selected check from its `cwd`, which defaults
to `root`. See the package names and
configuration options in the [CLI guide](cli.md#run-hook-pre-commit-and-hooks-install).

- `node-test` expands and deduplicates file globs, fails on unmatched patterns,
  and runs the current Node executable with a concise reporter.
- `unittest` defaults to `tests/` and `test*.py`. Set `python` to select a
  virtual environment, or `topLevelDirectory` to control the import root. The
  default interpreter is `python3` on Unix and `python` on Windows. An empty
  suite fails.
- `jest` runs the locally installed Jest with `--ci`, using the project's Jest
  config and discovery. Use `args` for additional Jest flags. [Jest CLI options](https://jestjs.io/docs/cli)
- `vitest` runs the locally installed Vitest once with `vitest run`.
  [Vitest CLI options](https://vitest.dev/guide/cli)
- `cargo` runs `cargo test`. Use `args` for options such as
  `--workspace` or `--manifest-path`. [Cargo test options](https://doc.rust-lang.org/cargo/commands/cargo-test.html)

Import `createNodeTestCommand(root, check)` and `NodeTestCheckConfig` from
`@slop-lab/qg-check-node-test` to prepare the Node command independently. Use
`node --test --test-reporter=@slop-lab/qg-check-node-test/node-test-reporter`
to run the reporter directly.

The shared `CheckConfig` schema lives in core and is re-exported by the runner.
Checks execute against the working tree. Staged rules use the index snapshot.
The CLI calls `collectCheckArtifacts(root, checks)` and passes the result as
`generatedArtifacts` to the rule runner. Library callers can use the same
function to classify Cargo build outputs.
