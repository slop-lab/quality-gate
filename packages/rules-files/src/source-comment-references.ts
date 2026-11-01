import { posix } from "node:path";
import type {
  FileReferenceOccurrence,
  FileReferencePlugin,
  ValidFileReferenceOptions,
} from "./file-references.js";
import { markdownReferences } from "./markdown-links.js";

export interface SourceCommentReferenceOptions
  extends ValidFileReferenceOptions {
  extensions?: string[];
}

const defaultExtensions = [
  ".c",
  ".cc",
  ".cpp",
  ".cxx",
  ".cs",
  ".cts",
  ".dart",
  ".go",
  ".h",
  ".hh",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".m",
  ".mm",
  ".mjs",
  ".mts",
  ".php",
  ".rs",
  ".scala",
  ".swift",
  ".ts",
  ".tsx",
];

/** Extract local Markdown links from whole-line //, ///, and //! comments. */
export const sourceCommentMarkdownReferencePlugin: FileReferencePlugin<SourceCommentReferenceOptions> =
  {
    id: "qg/source-comment-markdown",
    version: "1",
    cacheKey: "whole-line-slash-comments",
    supports(path, options) {
      const extensions = options.extensions ?? defaultExtensions;
      if (
        !Array.isArray(extensions) ||
        extensions.some((extension) => typeof extension !== "string")
      )
        throw new Error("source/valid-reference extensions must be strings.");
      return extensions.some(
        (extension) =>
          posix.extname(path).toLowerCase() === extension.toLowerCase(),
      );
    },
    extract({ content }) {
      const occurrences: FileReferenceOccurrence[] = [];
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        const match = line.match(/^(\s*\/\/(?:\/|!)?\s?)(.*)$/);
        if (!match) continue;
        const prefix = match[1] ?? "";
        const comment = match[2] ?? "";
        let cursor = 0;
        for (const occurrence of markdownReferences(comment)) {
          const linkStart = Math.max(cursor, occurrence.column - 1);
          const opening = comment.indexOf("](", linkStart);
          const target = comment.indexOf(
            occurrence.reference,
            opening < 0 ? linkStart : opening + 2,
          );
          cursor = target < 0 ? cursor : target + occurrence.reference.length;
          occurrences.push({
            reference: occurrence.reference,
            line: index + 1,
            column:
              prefix.length + (target < 0 ? occurrence.column - 1 : target) + 1,
            endColumn:
              prefix.length +
              (target < 0 ? occurrence.column - 1 : target) +
              occurrence.reference.length +
              1,
          });
        }
      }
      return occurrences;
    },
  };
