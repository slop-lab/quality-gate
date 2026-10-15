import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type {
  QualityGateConfig,
  QualityGateOverride,
  RuleConfig,
} from "@quality-gate/core";
import { parse } from "yaml";

const configNames = ["qualitygate.config.yaml", "qualitygate.config.yml"];

export async function loadConfig(
  root: string,
  requestedPath?: string,
): Promise<QualityGateConfig | undefined> {
  const candidates = requestedPath ? [requestedPath] : configNames;
  for (const candidate of candidates) {
    const path = isAbsolute(candidate) ? candidate : join(root, candidate);
    try {
      const document = parse(await readFile(path, "utf8")) as unknown;
      return normalizeConfig(document, candidate);
    } catch (error) {
      if (
        !requestedPath &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw new Error(
        `Failed to load ${candidate}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return undefined;
}

function normalizeConfig(value: unknown, path: string): QualityGateConfig {
  const object = requireObject(value, `${path} root`);
  const config: QualityGateConfig = {};
  if (object.scan !== undefined) {
    config.scan = requireObject(
      object.scan,
      "scan",
    ) as QualityGateConfig["scan"];
  }
  if (object.rules !== undefined) {
    config.rules = normalizeRules(object.rules, "rules");
  }
  if (object.overrides !== undefined) {
    if (!Array.isArray(object.overrides))
      throw new Error("overrides must be an array");
    config.overrides = object.overrides.map(normalizeOverride);
  }
  return config;
}

function normalizeOverride(value: unknown, index: number): QualityGateOverride {
  const object = requireObject(value, `overrides[${index}]`);
  return {
    files: requireStrings(object.files, `overrides[${index}].files`),
    ...(object.excludedFiles === undefined
      ? {}
      : {
          excludedFiles: requireStrings(
            object.excludedFiles,
            `overrides[${index}].excludedFiles`,
          ),
        }),
    rules: normalizeRules(object.rules, `overrides[${index}].rules`),
  };
}

function normalizeRules(
  value: unknown,
  label: string,
): Record<string, RuleConfig> {
  const rules = requireObject(value, label);
  return Object.fromEntries(
    Object.entries(rules).map(([id, setting]) => [
      id,
      normalizeRule(setting, `${label}.${id}`),
    ]),
  );
}

function normalizeRule(value: unknown, label: string): RuleConfig {
  if (typeof value === "string" || Array.isArray(value))
    return value as RuleConfig;
  const object = requireObject(value, label);
  const severity = object.severity ?? "error";
  if (!isSeverity(severity)) throw new Error(`${label}.severity is invalid`);
  return object.options === undefined
    ? severity
    : [severity, requireObject(object.options, `${label}.options`)];
}

function isSeverity(
  value: unknown,
): value is "off" | "info" | "warning" | "error" {
  return (
    value === "off" ||
    value === "info" ||
    value === "warning" ||
    value === "error"
  );
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value as string[];
}
