import type { Diagnostic, Rule } from "@quality-gate/core";

export interface ValidDocumentReferenceOptions {
  extensions?: string[];
  suppression?: string;
}

const defaults: Required<ValidDocumentReferenceOptions> = {
  extensions: [".md", ".mdx", ".txt", ".adoc", ".rst"],
  suppression: "quality-gate-suppress docs/valid-reference",
};
const referencePattern = /\b\w+(?:\/\w+)+\b/g;

export const validDocumentReferenceRule: Rule<ValidDocumentReferenceOptions> = {
  metadata: {
    id: "docs/valid-reference",
    name: "Valid document reference",
    description:
      "Reports slash-delimited document references whose target does not exist.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "file",
    requires: ["fileContent", "fileMetadata"],
    fixable: "suggestion",
    defaultOptions: defaults,
  },
  async check(context) {
    const candidates =
      context.mode === "changed"
        ? [
            ...new Set(
              context.changes
                .filter((item) => item.status !== "deleted")
                .map((item) => item.path),
            ),
          ]
        : await collectFiles(context.fs);
    const diagnostics: Diagnostic[] = [];
    for (const path of candidates) {
      const resolved = context.resolveConfig(path);
      if (!resolved.enabled) continue;
      const options = { ...defaults, ...resolved.options };
      if (
        !options.extensions.some((extension) => path.endsWith(extension)) ||
        !(await context.fs.isFile(path))
      )
        continue;
      const content = await context.fs.readFile(path);
      for (const match of content.matchAll(referencePattern)) {
        const reference = match[0];
        const offset = match.index ?? 0;
        const preceding = content.slice(0, offset);
        if (preceding.lastIndexOf("<!--") > preceding.lastIndexOf("-->"))
          continue;
        const lineEnd = content.indexOf("\n", offset);
        const tail = content.slice(
          offset + reference.length,
          lineEnd < 0 ? content.length : lineEnd,
        );
        const escapedSuppression = options.suppression.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );
        if (new RegExp(`^\\s*<!--\\s*${escapedSuppression}\\s*-->`).test(tail))
          continue;
        if (await context.fs.isFile(reference)) continue;
        const before = content.slice(0, offset);
        const line = before.split(/\r?\n/).length;
        const column = offset - Math.max(before.lastIndexOf("\n"), -1);
        diagnostics.push({
          ruleId: validDocumentReferenceRule.metadata.id,
          severity: resolved.severity,
          message: `Referenced file does not exist: ${reference}. If you meant ordinary text rather than a file, use a comma instead of '/'.`,
          path,
          line,
          column,
          endLine: line,
          endColumn: column + reference.length,
          scope: "file",
        });
      }
    }
    return diagnostics;
  },
};

async function collectFiles(
  fs: import("@quality-gate/core").FileSystemProvider,
): Promise<string[]> {
  const files: string[] = [];
  const pending = ["."];
  while (pending.length) {
    const directory = pending.shift();
    if (!directory) continue;
    for (const entry of await fs.readDirectory(directory)) {
      if (
        entry.type === "directory" &&
        ![".git", ".local", "node_modules", "dist"].includes(entry.name)
      )
        pending.push(entry.path);
      else if (entry.type === "file") files.push(entry.path);
    }
  }
  return files;
}
