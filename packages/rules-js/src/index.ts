export * from "./fixture-copy.js";
export * from "./package-name.js";
export * from "./pnpm.js";
export * from "./require-ts-check.js";

import { jsTestFixtureRules } from "./fixture-copy.js";
import { allowedPackageNameRule } from "./package-name.js";
import { packageManagerRules } from "./pnpm.js";
import { requireTsCheckRule } from "./require-ts-check.js";
export const jsDirectiveRules = [requireTsCheckRule];
export const packageJsonRules = [allowedPackageNameRule];
export const jsRules = [
  ...jsDirectiveRules,
  ...jsTestFixtureRules,
  ...packageJsonRules,
  ...packageManagerRules,
];
export const rules = jsRules;
/** Named selections from the same package; each rule retains its default settings. */
export const presets = {
  js: jsRules,
  "js-directives": jsDirectiveRules,
  "js-test-fixtures": jsTestFixtureRules,
};
