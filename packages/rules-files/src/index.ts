export * from "./directory-limits.js";
export * from "./document-references.js";
export * from "./file-paths.js";
export * from "./file-references.js";
export * from "./limits.js";
export * from "./markdown-characters.js";
export * from "./markdown-table-style.js";
export * from "./required-files.js";
export * from "./source-comment-references.js";
export * from "./source-references.js";
export * from "./suppression-reason.js";

import { maxFilesPerDirectoryRule } from "./directory-limits.js";
import { validDocumentReferenceRule } from "./document-references.js";
import { allowedFilenameRule, allowedFilePathRule } from "./file-paths.js";
import { fileRules } from "./limits.js";
import { allowedMarkdownCharactersRule } from "./markdown-characters.js";
import {
  noExtraTableCellWhitespaceRule,
  noRedundantTableRowNumbersRule,
} from "./markdown-table-style.js";
import {
  repositoryFileRules,
  requiredCompanionsRule,
} from "./required-files.js";
import { validSourceReferenceRule } from "./source-references.js";
import { requireSuppressionReasonRule } from "./suppression-reason.js";
export const layoutRules = [
  allowedFilenameRule,
  allowedFilePathRule,
  ...repositoryFileRules,
  requiredCompanionsRule,
];
export const fileLimitRules = [...fileRules, maxFilesPerDirectoryRule];
export const markdownRules = [
  validDocumentReferenceRule,
  allowedMarkdownCharactersRule,
  noExtraTableCellWhitespaceRule,
  noRedundantTableRowNumbersRule,
  requireSuppressionReasonRule,
];
export const sourceRules = [validSourceReferenceRule];
export const rules = [
  ...layoutRules,
  ...fileLimitRules,
  ...markdownRules,
  ...sourceRules,
];
export const presets = {
  layout: layoutRules,
  limits: fileLimitRules,
  markdown: markdownRules,
  source: sourceRules,
};
