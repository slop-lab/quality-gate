import { posix } from "node:path";
import {
  cacheKey,
  type Diagnostic,
  type FileSystemProvider,
  type GeneratedArtifactRuleOptions,
  type Rule,
} from "@slop-lab/qg-core";

import { markdownReferences } from "./markdown-links.js";

export interface ValidDocumentReferenceOptions
  extends GeneratedArtifactRuleOptions {
  extensions?: string[];
  suppression?: string;
  /** Markdown links by default; slash-delimited is the legacy strict prose policy. */
  referenceStyle?: "markdown-links" | "slash-delimited";
}

interface ReferenceOccurrence {
  reference: string;
  line: number;
  column: number;
}

const defaults: Required<ValidDocumentReferenceOptions> = {
  extensions: [".md", ".mdx", ".txt", ".adoc", ".rst"],
  suppression: "qg-suppress docs/valid-reference",
  includeGenerated: false,
  referenceStyle: "markdown-links",
};
const referencePattern = /\b\w+(?:\/\w+)+\b/g;
const parserVersion = "2";

export const validDocumentReferenceRule: Rule<ValidDocumentReferenceOptions> = {
  metadata: {
    id: "docs/valid-reference",
    name: "Valid document reference",
    description:
      "Validates local Markdown links and optionally strict slash-delimited references.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "file",
    requires: ["fileContent", "fileMetadata"],
    fixable: "suggestion",
    defaultOptions: defaults,
    ignoreGeneratedArtifacts: true,
  },
  async check(context) {
    const candidates =
      context.mode === "changed" &&
      !context.changes.some((change) =>
        ["deleted", "renamed"].includes(change.status),
      )
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
      if (
        !["markdown-links", "slash-delimited"].includes(options.referenceStyle)
      )
        throw new Error(
          "docs/valid-reference: referenceStyle must be markdown-links or slash-delimited.",
        );
      const bytes = await context.fs.readFileBytes(path);
      const key = cacheKey(
        parserVersion,
        path,
        options.suppression,
        options.referenceStyle,
        bytes,
      );
      let occurrences = await context.cache.get<ReferenceOccurrence[]>(key);
      if (!occurrences) {
        const content = new TextDecoder().decode(bytes);
        occurrences =
          options.referenceStyle === "markdown-links"
            ? markdownReferences(content)
            : parseOccurrences(content, options.suppression);
        await context.cache.set(key, occurrences);
      }
      for (const { reference, line, column } of occurrences) {
        let target = reference;
        if (options.referenceStyle === "markdown-links") {
          if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue;
          const pathname = reference.split(/[?#]/)[0];
          if (!pathname) continue;
          try {
            target = decodeURIComponent(pathname);
          } catch {
            target = pathname;
          }
          target = target.startsWith("/")
            ? posix.normalize(target.slice(1))
            : posix.join(posix.dirname(path), target);
        }
        const outside = target === ".." || target.startsWith("../");
        if (
          !outside &&
          ((await context.fs.isFile(target)) ||
            (options.referenceStyle === "markdown-links" &&
              (await context.fs.isDirectory(target))))
        )
          continue;
        diagnostics.push({
          ruleId: validDocumentReferenceRule.metadata.id,
          severity: resolved.severity,
          message:
            options.referenceStyle === "markdown-links"
              ? `Local Markdown target does not exist: ${reference} (resolved to ${target}).`
              : `Referenced file does not exist: ${reference}. If you meant ordinary text rather than a file, use a comma instead of '/'.`,
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

function parseOccurrences(
  content: string,
  suppression: string,
): ReferenceOccurrence[] {
  const occurrences: ReferenceOccurrence[] = [];
  const escaped = suppression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suppressionPattern = new RegExp(`^\\s*<!--\\s*${escaped}\\s*-->`);
  for (const match of content.matchAll(referencePattern)) {
    const reference = match[0];
    const offset = match.index ?? 0;
    const preceding = content.slice(0, offset);
    if (preceding.lastIndexOf("<!--") > preceding.lastIndexOf("-->")) continue;
    const lineEnd = content.indexOf("\n", offset);
    const tail = content.slice(
      offset + reference.length,
      lineEnd < 0 ? content.length : lineEnd,
    );
    if (suppressionPattern.test(tail)) continue;
    occurrences.push({
      reference,
      line: preceding.split(/\r?\n/).length,
      column: offset - Math.max(preceding.lastIndexOf("\n"), -1),
    });
  }
  return occurrences;
}

async function collectFiles(fs: FileSystemProvider): Promise<string[]> {
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
