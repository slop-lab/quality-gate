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

With this check configured, QG treats `target/` build outputs as generated,
including in nested crates. For a custom output directory, add its pattern to
`artifacts.generated.include`.
