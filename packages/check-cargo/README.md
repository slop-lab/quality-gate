# @slop-lab/qg-check-cargo

Runs `cargo test` using Cargo on your PATH. Set `args` for extra Cargo flags.

```sh
npm install --save-dev @slop-lab/qg-check-cargo
```

```yaml
checks:
  tests:
    type: cargo
```

QG queries Cargo for its output directories and treats them as generated. This
also covers paths set in Cargo config, `CARGO_TARGET_DIR`, or
`args: [--target-dir, build/rust]`. Set `cwd` to run in a nested Rust package.
