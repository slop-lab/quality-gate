export * from "./file-paths.js";
export * from "./required-files.js";

import { allowedFilenameRule, allowedFilePathRule } from "./file-paths.js";
import {
  repositoryFileRules,
  requiredCompanionsRule,
} from "./required-files.js";
export const rules = [
  allowedFilenameRule,
  allowedFilePathRule,
  ...repositoryFileRules,
  requiredCompanionsRule,
];
