import type { Diagnostic, ProcessResult } from "@slop-lab/qg-core";
import {
  createStdinRule,
  type StdinRuleOptions,
  validateStdinArgs,
} from "@slop-lab/qg-stdin-adapter";
export interface PrettierOptions extends StdinRuleOptions {}

export const prettierRule = createStdinRule<PrettierOptions>({
  id: "external/prettier",
  name: "External prettier check",
  description:
    "Checks snapshot contents using the project's prettier installation. Explicit opt-in required.",
  packageName: "prettier",
  binaryName: "prettier",
  files: [
    "**/*.js",
    "**/*.jsx",
    "**/*.mjs",
    "**/*.cjs",
    "**/*.ts",
    "**/*.tsx",
    "**/*.json",
    "**/*.jsonc",
    "**/*.css",
    "**/*.scss",
    "**/*.html",
    "**/*.vue",
    "**/*.yaml",
    "**/*.yml",
    "**/*.md",
    "**/*.mdx",
  ],
  validateOptions(options) {
    validateStdinArgs("external/prettier", options.args ?? []);
  },
  args: (path, options) => [
    ...(options.args ?? []),
    "--check",
    "--stdin-filepath",
    path,
  ],
  diagnostics: diagnosticsFor,
});

export const rules = [prettierRule];

function diagnosticsFor(
  path: string,
  _options: PrettierOptions,
  _input: string,
  result: ProcessResult,
): Diagnostic[] {
  const id = "external/prettier";
  const diagnostic = (message: string): Diagnostic => ({
    ruleId: id,
    severity: "error",
    message,
    path,
    scope: "file",
    metadata: {
      tool: "prettier",
      stderr: result.stderr,
      stdout: result.stdout,
    },
  });
  if (![0, 1].includes(result.exitCode))
    throw new Error(
      `${id} failed for ${path} (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  if (result.exitCode === 0) return [];
  return [diagnostic("Prettier formatting differs from the checked contents.")];
}
