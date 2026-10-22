export * from "./directory-limits.js";
export * from "./limits.js";

import { maxFilesPerDirectoryRule } from "./directory-limits.js";
import { fileRules } from "./limits.js";
export const rules = [...fileRules, maxFilesPerDirectoryRule];
