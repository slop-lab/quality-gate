import type { Rule } from "@slop-lab/qg-core";
import {
  allowedFilenameRule,
  allowedFilePathRule,
  repositoryFileRules,
  requiredCompanionsRule,
} from "@slop-lab/qg-rules-file-layout";
import {
  fileRules,
  maxFilesPerDirectoryRule,
} from "@slop-lab/qg-rules-file-limits";
import {
  noLoneGitkeepRule,
  noTrackedLocalFilesRule,
} from "@slop-lab/qg-rules-git";
import {
  allowedMarkdownCharactersRule,
  requireSuppressionReasonRule,
  validDocumentReferenceRule,
} from "@slop-lab/qg-rules-markdown";

/** The default rule set used by the CLI and available to library callers. */
export const recommendedRules: Rule[] = [
  noLoneGitkeepRule,
  noTrackedLocalFilesRule,
  ...fileRules,
  allowedFilenameRule,
  allowedFilePathRule,
  maxFilesPerDirectoryRule,
  ...repositoryFileRules,
  requiredCompanionsRule,
  validDocumentReferenceRule,
  allowedMarkdownCharactersRule,
  requireSuppressionReasonRule,
];
