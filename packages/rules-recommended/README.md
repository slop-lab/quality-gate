# QG Recommended Rules

`@slop-lab/qg-rules-recommended` exports `recommendedRules`, the default rule
set used by the `qg` CLI. It contains language-independent Git and file rules.
It has no runtime dependency on the JS or test rule packages. Markdown character
checks and suppression-reason checks are enabled by default.
Root `README.md` and LF `.gitattributes` requirements are also enabled by
default through `repo/require-readme` and `repo/require-gitattributes`.
`files/required-companions` is available for configurable nearby-file policies
and remains off by default. See [file policies](https://github.com/slop-lab/quality-gate/blob/main/docs/file-policies.md).
`files/max-lines` warns above 500 lines and errors above 1000 lines. Shared
[generated artifact registrations](https://github.com/slop-lab/quality-gate/blob/main/docs/generated-artifacts.md) exempt
generated content across participating file, JS, test, and external-tool rules.
`files/max-files-per-directory` warns above 50 direct files and errors above
100 per directory. It also excludes generated artifacts by default. See
[directory limits](https://github.com/slop-lab/quality-gate/blob/main/docs/directory-limits.md) for configuration and
`scope: self` overrides that do not affect descendants.

Use it with the independent runner:

```ts
import { runQualityGate } from "@slop-lab/qg-core";
import { recommendedRules } from "@slop-lab/qg-rules-recommended";

const result = await runQualityGate({
  root: process.cwd(),
  mode: "full",
  rules: recommendedRules,
  config: {
    rules: { "docs/valid-reference": "error" },
  },
});
```

Core does not load any rules automatically. Library callers can use this set,
individual rule packages, or their own `Rule` objects. CLI users configure
severity and options through `.qg.yaml` or `.qg.yml`.

JavaScript and TypeScript projects can separately install
`@slop-lab/qg-rules-js` and opt in with `presets: [js]` in the root `.qg.yaml`.
The TypeScript fixture policy is separately available from
`@slop-lab/qg-rules-js-test` with `presets: [js-test]`.
Library callers compose these exports explicitly, for example
`rules: [...recommendedRules, ...jsRules]`; core does not load CLI presets.
