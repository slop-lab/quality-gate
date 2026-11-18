# QG test adapter examples

Each directory is a small consumer project with its own QG configuration,
development dependencies, and a passing test.

| Example | Tool |
| --- | --- |
| [Node.js](node-test/) | Built-in Node.js test runner |
| [Python](unittest/) | Standard-library `unittest` |
| [Jest](jest/) | Project-local Jest |
| [Vitest](vitest/) | Project-local Vitest |
| [Cargo](cargo/) | Rust crate with a custom Cargo output directory |

From the repository root, install the pinned toolchains and workspace
dependencies. Then point the built CLI at one example.

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- just build
mise exec -- node packages/cli/dist/index.mjs check --root examples/jest --full
```

Replace `examples/jest` with another example directory to try its adapter.
Each example uses `qg.config.yaml`, a supported root configuration name that
lets the example keep its own checks when it lives inside this checkout.
In a separate Git project with the QG packages installed, the same example
also runs through its `pnpm check` package script.

Run the integration tests for all examples with `mise exec -- just test-examples`.
The same tests run in `just test` and the repository quality gate. They run each
example in a temporary Git repository, check the CLI and pre-commit output,
then change a passing assertion to verify the failed check is reported.
