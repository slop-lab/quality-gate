import type { Rule } from "@slop-lab/qg-core";
import {
  allowedMarkdownCharactersRule,
  fileRules,
  maxFilesPerDirectoryRule,
  repositoryFileRules,
  requiredCompanionsRule,
  requireSuppressionReasonRule,
  validDocumentReferenceRule,
} from "@slop-lab/qg-rules-files";
import {
  noLoneGitkeepRule,
  noTrackedLocalFilesRule,
} from "@slop-lab/qg-rules-git";
import { jsRules } from "@slop-lab/qg-rules-js";
import { testRules } from "@slop-lab/qg-rules-test";

/** The default rule set used by the CLI and available to library callers. */
export const recommendedRules: Rule[] = [
  noLoneGitkeepRule,
  noTrackedLocalFilesRule,
  ...fileRules,
  maxFilesPerDirectoryRule,
  ...repositoryFileRules,
  requiredCompanionsRule,
  validDocumentReferenceRule,
  allowedMarkdownCharactersRule,
  requireSuppressionReasonRule,
  ...jsRules,
  ...testRules,
];
