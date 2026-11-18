# @slop-lab/qg-check-node-test

Runs Node tests through the current Node executable. Set `files` to test paths or globs.

```sh
npm install --save-dev @slop-lab/qg-check-node-test
```

```yaml
checks:
  tests:
    type: node-test
    files: ["test/**/*.test.mjs"]
```

`createNodeTestCommand(root, check)`, `NodeTestCheckConfig`, and the
`./node-test-reporter` subpath moved here from `@slop-lab/qg-check-runner`.
Use the reporter directly with Node's CLI.

```sh
node --test --test-reporter=@slop-lab/qg-check-node-test/node-test-reporter
```
