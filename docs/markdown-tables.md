# Markdown table style

The recommended rule set enables two table policies for `.md`, `.markdown`,
and `.mdx` files.

`markdown/no-extra-table-cell-whitespace` reports repeated cell padding that
does not match the delimiter row's column widths and alignment markers.
Compact cells such as `| value |` and column-aligned padding both pass.
Missing padding is allowed.

`markdown/no-redundant-table-row-numbers` reports a numeric first column when
its header (`#`, `No.`, `Number`, `Order`, or `Row`) identifies it as a row
number. Table order is already visible, so omit that column. Numeric data under
other headers and in other columns remains valid.

Both rules recognize tables through their Markdown delimiter rows, ignore
fenced and indented code, and handle escaped pipes and inline-code pipes. They
support the shared document `extensions` and `ignoredPaths` options, normal
path overrides and suppressions, and generated-file exclusion.

## Formatter compatibility

Prettier 3.10.1 aligns table columns with `proseWrap: preserve` or
`proseWrap: always`. With `proseWrap: never`, it switches to compact output
when the aligned table exceeds `printWidth`. Short tables can still gain
padding. Biome 2.6.8 also aligns Markdown table columns, including when
`lineWidth` is smaller than the table. See the
[formatter example](../examples/markdown-formatters/) for reproduction commands.
QG accepts the compact input and the formatted output from both tools.
