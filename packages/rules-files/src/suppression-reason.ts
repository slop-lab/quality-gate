import {
  type Diagnostic,
  DocumentSuppressions,
  type Rule,
} from "@slop-lab/qg-core";
import {
  type DocumentFileOptions,
  documentPaths,
  isDocumentPath,
} from "./document-files.js";

export const requireSuppressionReasonRule: Rule<DocumentFileOptions> = {
  metadata: {
    id: "qg/require-suppression-reason",
    name: "Require suppression reasons",
    description:
      "Requires a non-empty reason on word, line, next-line, and range-start suppressions.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "file",
    requires: ["fileContent"],
    fixable: "suggestion",
    defaultOptions: {},
    ignoreGeneratedArtifacts: true,
  },
  async check(context) {
    const diagnostics: Diagnostic[] = [];
    for (const path of await documentPaths(context)) {
      const resolved = context.resolveConfig(path);
      if (
        !resolved.enabled ||
        !isDocumentPath(path, resolved.options) ||
        !(await context.fs.isFile(path))
      )
        continue;
      const document = new DocumentSuppressions(
        await context.fs.readFile(path),
      );
      for (const directive of document.directives) {
        if (
          directive.command === "qg-suppress-end" ||
          directive.reason.length > 0
        )
          continue;
        diagnostics.push({
          ruleId: requireSuppressionReasonRule.metadata.id,
          severity: resolved.severity,
          message: `${directive.command} requires a non-empty reason after ':'.`,
          path,
          line: directive.line,
          column: directive.column,
          scope: "file",
          suppressible: false,
          suggestedFix: {
            message: "Add ': <reason>' before the closing comment marker.",
          },
        });
      }
    }
    return diagnostics;
  },
};
