import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import type {
  QualityGateConfig,
  QualityGateOverride,
  RuleConfig,
} from "@quality-gate/core";
import { parse } from "yaml";

const localConfigNames = [".qualitygate.yaml", ".qualitygate.yml"];
const legacyRootConfigNames = [
  "qualitygate.config.yaml",
  "qualitygate.config.yml",
];
const ignoredDirectories = new Set([
  ".git",
  ".quality-gate",
  "dist",
  "node_modules",
]);

export async function loadConfig(
  root: string,
  requestedPath?: string,
): Promise<QualityGateConfig | undefined> {
  const rootConfigPath = requestedPath
    ? isAbsolute(requestedPath)
      ? requestedPath
      : join(root, requestedPath)
    : await findRootConfig(root);
  const configPaths = await findLocalConfigs(root);
  const nestedPaths = configPaths
    .filter(
      (path) =>
        path !== rootConfigPath &&
        normalizePath(relative(root, dirname(path))) !== "",
    )
    .sort(
      (left, right) =>
        pathDepth(root, left) - pathDepth(root, right) ||
        left.localeCompare(right),
    );

  let result = rootConfigPath
    ? await readConfig(
        rootConfigPath,
        relative(root, rootConfigPath) || rootConfigPath,
      )
    : undefined;

  for (const path of nestedPaths) {
    const directory = normalizePath(relative(root, dirname(path)));
    const nested = await readConfig(path, relative(root, path));
    if (nested.scan) {
      throw new Error(
        `${relative(root, path)}: scan is only allowed in the root config`,
      );
    }
    result ??= {};
    result.overrides ??= [];
    if (nested.rules) {
      result.overrides.push({
        files: [`${directory}/**`],
        rules: nested.rules,
      });
    }
    result.overrides.push(
      ...(nested.overrides ?? []).map((override) => ({
        ...override,
        files: override.files.map((pattern) => prefixGlob(directory, pattern)),
        ...(override.excludedFiles
          ? {
              excludedFiles: override.excludedFiles.map((pattern) =>
                prefixGlob(directory, pattern),
              ),
            }
          : {}),
      })),
    );
  }
  return result;
}

async function findRootConfig(root: string): Promise<string | undefined> {
  for (const name of [...localConfigNames, ...legacyRootConfigNames]) {
    const path = join(root, name);
    try {
      await readFile(path);
      return path;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return undefined;
}

async function findLocalConfigs(root: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.shift();
    if (!directory) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
        pending.push(join(directory, entry.name));
      } else if (entry.isFile() && localConfigNames.includes(entry.name)) {
        found.push(join(directory, entry.name));
      }
    }
  }
  return found;
}

async function readConfig(
  path: string,
  label: string,
): Promise<QualityGateConfig> {
  try {
    return normalizeConfig(
      parse(await readFile(path, "utf8")) as unknown,
      label,
    );
  } catch (error) {
    throw new Error(
      `Failed to load ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function prefixGlob(directory: string, pattern: string): string {
  const normalized = pattern.replace(/^\.\//, "").replace(/^\//, "");
  return normalized === "**" ? `${directory}/**` : `${directory}/${normalized}`;
}

function pathDepth(root: string, path: string): number {
  return normalizePath(relative(root, path)).split("/").length;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
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
