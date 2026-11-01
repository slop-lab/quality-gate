import type { Rule } from "@slop-lab/qg-core";
import {
  allowedFilenameRule,
  allowedFilePathRule,
  allowedMarkdownCharactersRule,
  fileRules,
  maxFilesPerDirectoryRule,
  noExtraTableCellWhitespaceRule,
  noRedundantTableRowNumbersRule,
  repositoryFileRules,
  requiredCompanionsRule,
  requireSuppressionReasonRule,
  validDocumentReferenceRule,
  validSourceReferenceRule,
} from "@slop-lab/qg-rules-files";
import {
  noIgnoredTrackedFilesRule,
  noLoneGitkeepRule,
  noTrackedLocalFilesRule,
} from "@slop-lab/qg-rules-git";

/** The default rule set used by the CLI and available to library callers. */
export const recommendedRules: Rule[] = [
  noLoneGitkeepRule,
  noIgnoredTrackedFilesRule,
  noTrackedLocalFilesRule,
  ...fileRules,
  allowedFilenameRule,
  allowedFilePathRule,
  maxFilesPerDirectoryRule,
  ...repositoryFileRules,
  requiredCompanionsRule,
  validDocumentReferenceRule,
  validSourceReferenceRule,
  allowedMarkdownCharactersRule,
  noExtraTableCellWhitespaceRule,
  noRedundantTableRowNumbersRule,
  requireSuppressionReasonRule,
];
