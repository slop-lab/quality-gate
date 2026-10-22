export * from "./directory-limits.js";
export * from "./document-references.js";
export * from "./file-paths.js";
export * from "./limits.js";
export * from "./markdown-characters.js";
export * from "./required-files.js";
export * from "./suppression-reason.js";

import { maxFilesPerDirectoryRule } from "./directory-limits.js";
import { validDocumentReferenceRule } from "./document-references.js";
import { allowedFilenameRule, allowedFilePathRule } from "./file-paths.js";
import { fileRules } from "./limits.js";
import { allowedMarkdownCharactersRule } from "./markdown-characters.js";
import {
  repositoryFileRules,
  requiredCompanionsRule,
} from "./required-files.js";
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
  requireSuppressionReasonRule,
];
export const rules = [...layoutRules, ...fileLimitRules, ...markdownRules];
export const presets = {
  layout: layoutRules,
  limits: fileLimitRules,
  markdown: markdownRules,
};
