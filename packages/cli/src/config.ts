import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import type {
  PreCommitCheck,
  QualityGateConfig,
  QualityGateOverride,
  RuleConfig,
} from "@slop-lab/qg-core";
import { parse } from "yaml";

const localConfigNames = [".qg.yaml", ".qg.yml"];
const alternateRootConfigNames = ["qg.config.yaml", "qg.config.yml"];
const ignoredDirectories = new Set([".git", ".qg", "dist", "node_modules"]);

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
    if (nested.presets)
      throw new Error(
        `${relative(root, path)}: presets is only allowed in the root config`,
      );
    if (nested.scan) {
      throw new Error(
        `${relative(root, path)}: scan is only allowed in the root config`,
      );
    }
    if (nested.hooks)
      throw new Error(
        `${relative(root, path)}: hooks is only allowed in the root config`,
      );
    if (nested.artifacts)
      throw new Error(
        `${relative(root, path)}: artifacts is only allowed in the root config`,
      );
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
        ...(override.directory !== undefined || override.scope !== undefined
          ? {
              directory: normalizePath(
                join(directory, override.directory ?? "."),
              ),
            }
          : {
              files: (override.files ?? ["**"]).map((pattern) =>
                prefixGlob(directory, pattern),
              ),
            }),
        ...(override.excludedFiles &&
        override.directory === undefined &&
        override.scope === undefined
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
  for (const name of [...localConfigNames, ...alternateRootConfigNames]) {
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
  if (object.presets !== undefined) {
    const presets = requireStrings(object.presets, "presets");
    if (presets.some((preset) => preset !== "js" && preset !== "test"))
      throw new Error("presets may only contain js or test");
    config.presets = presets as ("js" | "test")[];
  }
  if (object.hooks !== undefined) {
    const hooks = requireObject(object.hooks, "hooks");
    const preCommit =
      hooks.preCommit === undefined
        ? {}
        : requireObject(hooks.preCommit, "hooks.preCommit");
    if (
      preCommit.installation !== undefined &&
      !["check", "auto", "off"].includes(preCommit.installation as string)
    )
      throw new Error(
        "hooks.preCommit.installation must be check, auto, or off",
      );
    if (preCommit.checks !== undefined && !Array.isArray(preCommit.checks))
      throw new Error("hooks.preCommit.checks must be an array");
    config.hooks = {
      preCommit: {
        ...(preCommit.installation === undefined
          ? {}
          : {
              installation: preCommit.installation as "check" | "auto" | "off",
            }),
        checks: ((preCommit.checks as unknown[] | undefined) ?? []).map(
          normalizePreCommitCheck,
        ),
      },
    };
  }
  if (object.artifacts !== undefined) {
    const artifacts = requireObject(object.artifacts, "artifacts");
    const generated =
      artifacts.generated === undefined
        ? undefined
        : requireObject(artifacts.generated, "artifacts.generated");
    if (
      generated?.defaults !== undefined &&
      typeof generated.defaults !== "boolean"
    )
      throw new Error("artifacts.generated.defaults must be a boolean");
    config.artifacts =
      generated === undefined
        ? {}
        : {
            generated: {
              ...(generated.defaults === undefined
                ? {}
                : { defaults: generated.defaults as boolean }),
              ...(generated.include === undefined
                ? {}
                : {
                    include: requireStrings(
                      generated.include,
                      "artifacts.generated.include",
                    ),
                  }),
              ...(generated.exclude === undefined
                ? {}
                : {
                    exclude: requireStrings(
                      generated.exclude,
                      "artifacts.generated.exclude",
                    ),
                  }),
            },
          };
  }
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
  if (
    object.files === undefined &&
    object.directory === undefined &&
    object.scope === undefined
  )
    throw new Error(`overrides[${index}] requires files, directory, or scope`);
  if (
    object.directory !== undefined &&
    (typeof object.directory !== "string" ||
      object.directory.startsWith("/") ||
      /[\\:\0]/.test(object.directory) ||
      object.directory.split("/").includes(".."))
  )
    throw new Error(
      `overrides[${index}].directory must be a project-relative path using '/'`,
    );
  if (
    object.scope !== undefined &&
    object.scope !== "self" &&
    object.scope !== "subtree"
  )
    throw new Error(`overrides[${index}].scope must be self or subtree`);
  return {
    ...(object.files === undefined
      ? {}
      : { files: requireStrings(object.files, `overrides[${index}].files`) }),
    ...(object.directory === undefined
      ? {}
      : { directory: object.directory as string }),
    ...(object.scope === undefined
      ? {}
      : { scope: object.scope as "self" | "subtree" }),
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
  if (object.message !== undefined && typeof object.message !== "string")
    throw new Error(`${label}.message must be a string`);
  return {
    severity,
    ...(object.options === undefined
      ? {}
      : { options: requireObject(object.options, `${label}.options`) }),
    ...(object.message === undefined
      ? {}
      : { message: object.message as string }),
  };
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

function normalizePreCommitCheck(
  value: unknown,
  index: number,
): PreCommitCheck {
  const label = `hooks.preCommit.checks[${index}]`;
  const object = requireObject(value, label);
  for (const key of ["name", "command"])
    if (typeof object[key] !== "string" || !(object[key] as string).trim())
      throw new Error(`${label}.${key} must be a non-empty string`);
  if (object.message !== undefined && typeof object.message !== "string")
    throw new Error(`${label}.message must be a string`);
  if (
    object.timeoutMs !== undefined &&
    (typeof object.timeoutMs !== "number" ||
      !Number.isFinite(object.timeoutMs) ||
      object.timeoutMs <= 0)
  )
    throw new Error(`${label}.timeoutMs must be positive`);
  return {
    name: object.name as string,
    command: object.command as string,
    ...(object.args === undefined
      ? {}
      : { args: requireStrings(object.args, `${label}.args`) }),
    ...(object.message === undefined
      ? {}
      : { message: object.message as string }),
    ...(object.timeoutMs === undefined
      ? {}
      : { timeoutMs: object.timeoutMs as number }),
  };
}
