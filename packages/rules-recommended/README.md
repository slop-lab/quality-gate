# QG Recommended Rules

`@slop-lab/qg-rules-recommended` exports `recommendedRules`, the default rule
set used by the `qg` CLI. It composes the Git, file, JavaScript, and test
rule packages as runtime dependencies. Rule implementations and default
severities come from the individual rule packages. Markdown character checks
and suppression-reason checks are enabled by default, as is
`js/require-ts-check` for JavaScript files.
The included `external/biome`, `external/prettier`, and `external/eslint`
adapters are off by default and require explicit project configuration.

Use it with the independent runner:

```ts
import { runQualityGate } from "@slop-lab/qg-core";
import { recommendedRules } from "@slop-lab/qg-rules-recommended";

const result = await runQualityGate({
  root: process.cwd(),
  mode: "full",
  rules: recommendedRules,
  config: {
    rules: { "docs/valid-reference": "off" },
  },
});
```

Core does not load any rules automatically. Library callers can use this set,
individual rule packages, or their own `Rule` objects. CLI users configure
severity and options through `.qg.yaml` or `.qg.yml`.
