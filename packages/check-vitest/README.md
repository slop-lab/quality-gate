# @slop-lab/qg-check-vitest

Runs the project's installed Vitest once using `vitest run`. Vitest reads the
project's existing configuration. Set `args` for extra Vitest flags.

```sh
npm install --save-dev @slop-lab/qg-check-vitest vitest
```

```yaml
checks:
  tests:
    type: vitest
```
