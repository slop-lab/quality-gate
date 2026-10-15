import type { Rule } from "@slop-lab/qg-core";
import {
  fileRules,
  validDocumentReferenceRule,
} from "@slop-lab/qg-rules-files";
import {
  noLoneGitkeepRule,
  noTrackedLocalFilesRule,
} from "@slop-lab/qg-rules-git";
import { packageManagerRules } from "@slop-lab/qg-rules-package-manager";
import { testRules } from "@slop-lab/qg-rules-test";

/** The default rule set used by the CLI and available to library callers. */
export const recommendedRules: Rule[] = [
  noLoneGitkeepRule,
  noTrackedLocalFilesRule,
  ...fileRules,
  validDocumentReferenceRule,
  ...packageManagerRules,
  ...testRules,
];
