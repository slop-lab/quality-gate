import { externalToolRules } from "./external-tools.js";
import { allowedPackageNameRule } from "./package-name.js";
import { requireTsCheckRule } from "./require-ts-check.js";
import { packageManagerRules } from "./rules.js";

export * from "./external-tools.js";
export * from "./package-name.js";
export * from "./require-ts-check.js";
export * from "./rules.js";

export const jsRules = [
  ...packageManagerRules,
  allowedPackageNameRule,
  requireTsCheckRule,
  ...externalToolRules,
];
