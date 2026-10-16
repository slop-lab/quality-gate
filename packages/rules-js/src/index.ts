import { externalToolRules } from "./external-tools.js";
import { requireTsCheckRule } from "./require-ts-check.js";
import { packageManagerRules } from "./rules.js";

export * from "./external-tools.js";
export * from "./require-ts-check.js";
export * from "./rules.js";

export const jsRules = [
  ...packageManagerRules,
  requireTsCheckRule,
  ...externalToolRules,
];
