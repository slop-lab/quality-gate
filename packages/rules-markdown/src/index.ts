export * from "./document-references.js";
export * from "./markdown-characters.js";
export * from "./suppression-reason.js";

import { validDocumentReferenceRule } from "./document-references.js";
import { allowedMarkdownCharactersRule } from "./markdown-characters.js";
import { requireSuppressionReasonRule } from "./suppression-reason.js";
export const rules = [
  validDocumentReferenceRule,
  allowedMarkdownCharactersRule,
  requireSuppressionReasonRule,
];
