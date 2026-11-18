# Markdown formatter example

This example uses Prettier 3.10.1, Biome 2.6.8, and two compact tables with
different widths. After installing workspace dependencies and building QG,
run these commands from the repository root.

```sh
cd examples/markdown-formatters
pnpm exec prettier --prose-wrap preserve --print-width 20 table.md
pnpm exec prettier --prose-wrap always --print-width 20 table.md
pnpm exec prettier --prose-wrap never --print-width 80 table.md
pnpm exec prettier --prose-wrap never --print-width 20 table.md
pnpm exec biome format --config-path=biome-format.json --line-width=20 --stdin-file-path=table.md < table.md
```

Prettier aligns both tables in the first three runs. The fourth run keeps the
wide table compact and aligns the short table. Biome aligns both tables. The
repository's Biome 2.5.15 predates Markdown formatting, which was introduced
in [Biome 2.6](https://biomejs.dev/blog/biome-v2-6/).

Run `pnpm check` to check the original tables. To check the formatted output,
copy `table.md`, `README.md`, `.gitattributes`, and `qg.config.yaml` into a
scratch directory, initialize a Git repository there, and run
`node /path/to/quality-gate/packages/cli/dist/index.mjs check --full` from that
directory. Replace the copied `table.md` with any formatter output to verify
that it also passes. To see a diagnostic, add one more space before `Ready`
in a formatted row and run the check again.
