# QG Git Rules

`@slop-lab/qg-rules-git` provides QG Git hygiene checks, including lone
`.gitkeep` files, tracked local-only files, and ignored files that remain
tracked.
Requires Node.js 24 or later. Licensed under MIT.

These rules are included by `@slop-lab/qg-rules-recommended` and the `qg` CLI.
`git/no-ignored-tracked-files` checks Git's standard ignore sources against the
complete index in both changed and full scans. Remove a reported file from the
index or narrow the ignore rule; use its `ignoredPaths` option for an intentional
exception.
See the [CLI documentation](https://github.com/slop-lab/quality-gate/blob/main/docs/cli.md)
for rule configuration and staged scans.
