import type { Diagnostic, ProcessResult } from "@slop-lab/qg-core";
import {
  createStdinRule,
  type StdinRuleOptions,
  validateStdinArgs,
} from "@slop-lab/qg-rule-stdin";
export interface BiomeOptions extends StdinRuleOptions {
  /** Connect to an already running Biome server. */
  useServer?: boolean;
  mode?: "format";
}

export const biomeRule = createStdinRule<BiomeOptions>({
  id: "external/biome",
  name: "External biome check",
  description:
    "Checks snapshot contents using the project's biome installation. Explicit opt-in required.",
  packageName: "@biomejs/biome",
  binaryName: "biome",
  fallbackCommand: process.platform === "win32" ? "biome.exe" : "biome",
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
  ],
  defaultOptions: { mode: "format" },
  validateOptions(options) {
    if (options.mode !== undefined && options.mode !== "format")
      throw new Error(
        "external/biome: only format mode supports reliable stdin validation. Run biome check or biome lint through shared checks instead.",
      );
    validateStdinArgs("external/biome", options.args ?? []);
  },
  args: (path, options) => [
    options.mode ?? "format",
    ...(options.args ?? []),
    `--stdin-file-path=${path}`,
    ...(options.useServer ? ["--use-server"] : []),
  ],
  diagnostics: diagnosticsFor,
});

export const rules = [biomeRule];

function diagnosticsFor(
  path: string,
  options: BiomeOptions,
  input: string,
  result: ProcessResult,
): Diagnostic[] {
  const id = "external/biome";
  const diagnostic = (message: string): Diagnostic => ({
    ruleId: id,
    severity: "error",
    message,
    path,
    scope: "file",
    metadata: {
      tool: "biome",
      stderr: result.stderr,
    },
  });
  if (![0, 1].includes(result.exitCode))
    throw new Error(
      `${id} failed for ${path} (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  if (
    result.exitCode === 1 &&
    !result.stderr.includes("The contents aren't fixed")
  )
    throw new Error(
      `${id} failed for ${path}: ${result.stderr || result.stdout}`,
    );
  if (result.exitCode === 0)
    return result.stdout === input
      ? []
      : [diagnostic("Biome formatting differs from the checked contents.")];
  return [
    diagnostic(
      `Biome ${options.mode ?? "format"} failed: ${result.stderr.trim() || "the checked contents do not pass"}`,
    ),
  ];
}
