import type { Diagnostic, ProcessResult } from "@slop-lab/qg-core";
import {
  createStdinRule,
  type StdinRuleOptions,
  validateStdinArgs,
} from "@slop-lab/qg-stdin-adapter";
export interface ESLintOptions extends StdinRuleOptions {}

export const eslintRule = createStdinRule<ESLintOptions>({
  id: "external/eslint",
  name: "External eslint check",
  description:
    "Checks snapshot contents using the project's eslint installation. Explicit opt-in required.",
  packageName: "eslint",
  binaryName: "eslint",
  files: ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs", "**/*.ts", "**/*.tsx"],
  validateOptions(options) {
    validateStdinArgs("external/eslint", options.args ?? []);
  },
  args: (path, options) => [
    ...(options.args ?? []),
    "--stdin",
    "--stdin-filename",
    path,
    "--format",
    "json",
  ],
  diagnostics: diagnosticsFor,
});

export const rules = [eslintRule];

function diagnosticsFor(
  path: string,
  _options: ESLintOptions,
  _input: string,
  result: ProcessResult,
): Diagnostic[] {
  const id = "external/eslint";
  const diagnostic = (message: string): Diagnostic => ({
    ruleId: id,
    severity: "error",
    message,
    path,
    scope: "file",
    metadata: {
      tool: "eslint",
      stderr: result.stderr,
    },
  });
  if (![0, 1].includes(result.exitCode))
    throw new Error(
      `${id} failed for ${path} (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  const reports: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(reports))
    throw new Error(`${id}: expected a JSON report for ${path}.`);

  const diagnostics = reports.flatMap(
    (report: {
      messages: Array<{
        severity: number;
        message: string;
        ruleId?: string;
        line?: number;
        column?: number;
        endLine?: number;
        endColumn?: number;
      }>;
    }) =>
      report.messages
        .filter((message) => message.severity > 0)
        .map(
          (message): Diagnostic => ({
            ...diagnostic(
              message.ruleId
                ? `${message.ruleId}: ${message.message}`
                : message.message,
            ),
            severity: message.severity === 1 ? "warning" : "error",
            line: message.line,
            column: message.column,
            endLine: message.endLine,
            endColumn: message.endColumn,
            metadata: { tool: "eslint", toolRuleId: message.ruleId },
          }),
        ),
  );
  if (
    result.exitCode === 1 &&
    !diagnostics.some((item) => item.severity === "error")
  )
    diagnostics.push(
      diagnostic(
        `ESLint failed its exit threshold: ${result.stderr.trim() || "exit 1"}`,
      ),
    );
  return diagnostics;
}
