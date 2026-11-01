# Markdown table style

The recommended rule set enables two table policies for `.md`, `.markdown`,
and `.mdx` files.

`markdown/no-extra-table-cell-whitespace` reports repeated padding adjacent to
table delimiters. Use one padding space, such as `| value |`, rather than
`| value  |`. Missing padding is not reported.

`markdown/no-redundant-table-row-numbers` reports a numeric first column when
its header (`#`, `No.`, `Number`, `Order`, or `Row`) identifies it as a row
number. Table order is already visible, so omit that column. Numeric data under
other headers and in other columns remains valid.

Both rules recognize tables through their Markdown delimiter rows, ignore
fenced and indented code, and handle escaped pipes and inline-code pipes. They
support the shared document `extensions` and `ignoredPaths` options, normal
path overrides and suppressions, and generated-file exclusion.
