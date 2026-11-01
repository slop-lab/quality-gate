# Source file references and extractor plugins

The recommended rules include `source/valid-reference`. It recognizes inline
Markdown links in whole-line `//`, `///`, and `//!` comments and validates local
targets relative to the source file:

```ts
// [schema](../schema.json)
/// [parser notes](./parser.md)
//! [project guide](/docs/guide.md#usage)
```

The built-in extractor covers common slash-comment source extensions, including
C, C++, C#, Go, Java, JavaScript, Kotlin, Rust, Scala, Swift, and TypeScript.
Set its `extensions` option to replace that list. It deliberately ignores
trailing comments after code and Markdown reference definitions split across
multiple comment lines; this avoids treating strings and ordinary source text
as references. URL, email, and same-document fragment targets are also ignored.

There is no language-neutral standard that gives Markdown meaning to every
ordinary `//` comment. This syntax is therefore a QG convention. Existing
documentation systems provide related, language-specific alternatives:

- [Rustdoc documentation comments](https://doc.rust-lang.org/rustdoc/how-to-write-documentation.html) and [Doxygen Markdown](https://www.doxygen.nl/manual/markdown.html) accept Markdown links in supported documentation comments.
- [JSDoc `@see`](https://jsdoc.app/tags-see) and [JSDoc `{@link}`](https://jsdoc.app/tags-inline-link) provide explicit documentation links; [TSDoc](https://tsdoc.org/pages/tags/link/) standardizes `{@link}` for TypeScript documentation.
- [Javadoc](https://docs.oracle.com/en/java/javase/22/docs/specs/javadoc/doc-comment-spec.html) defines `@see` and `{@link}` rather than general Markdown links.

Prefer a project's native documentation convention when rendered API
documentation is the goal. Use the QG convention for lightweight repository
file relationships that should be checked even when no documentation generator
is present.

## Reusable extractor contract

`@slop-lab/qg-rules-files` exports `createValidFileReferenceRule` and the
`FileReferencePlugin` interface. A rule module can compose a new rule for any
source or configuration syntax:

```js
import { createValidFileReferenceRule } from "@slop-lab/qg-rules-files";

const configReferences = {
  id: "acme/config-references",
  version: "1",
  supports: (path) => path.endsWith(".cfg"),
  extract: ({ content }) =>
    content.split(/\r?\n/).flatMap((line, index) =>
      line.startsWith("ref=")
        ? [{ reference: line.slice(4), line: index + 1, column: 5 }]
        : [],
    ),
};

export const rules = [
  createValidFileReferenceRule({
    id: "acme/valid-config-reference",
    name: "Valid config reference",
    description: "Checks local ref= targets.",
    plugins: [configReferences],
  }),
];
```

Each extractor has a stable `id` and `version`. Set `cacheKey` when behavior
also depends on plugin configuration or another implementation fingerprint.
Reference cache keys contain the complete ordered plugin set, applicable
plugins, rule options, source path, and source bytes. Adding, removing,
reordering, upgrading, or reconfiguring an extractor therefore invalidates old
extraction results without clearing unrelated rule caches.

External modules compose and export their own rules. They do not mutate the
already-created built-in `source/valid-reference` rule. This keeps module load
order from changing a built-in rule's identity and cache namespace.

## Recheck trigger plugins

Core exports a versioned `RecheckTriggerPlugin` contract. Its async
`shouldRecheck({ mode, changes })` callback can request discovery of all
existing candidate files for dependency changes that a glob cannot express.
Pass plugins through `recheckTriggers` on `createValidFileReferenceRule` or
`createFilePathRule`.

`createGlobRecheckTrigger(patterns, id?)` is the built-in glob implementation,
and the older `createFilePathRule` `recheckOnChanges` option remains as a
compatibility shorthand. Reference rules also include a target-change trigger:
deletions and renames recheck untouched source files so a removed target cannot
leave a cached reference looking valid.
