import { posix } from "node:path";
import type {
  DiagnosticSeverity,
  GeneratedArtifacts,
  QualityGateConfig,
  QualityGateOverride,
  ResolvedRuleConfig,
  Rule,
  RuleConfig,
} from "./types.js";

export function resolveRuleConfig<TOptions>(
  config: QualityGateConfig | undefined,
  rule: Rule<TOptions>,
  path?: string,
  artifacts?: GeneratedArtifacts,
  kind: "file" | "directory" = "file",
): ResolvedRuleConfig<TOptions> {
  let resolved = mergeRuleConfig(
    rule.metadata.defaultEnabled === false
      ? "off"
      : rule.metadata.defaultSeverity,
    rule.metadata.defaultOptions as TOptions,
    config?.rules?.[rule.metadata.id] as RuleConfig<TOptions> | undefined,
  );

  if (path) {
    for (const override of config?.overrides ?? []) {
      if (matchesOverride(path, override, kind)) {
        resolved = mergeRuleConfig(
          resolved.enabled ? resolved.severity : "off",
          resolved.options,
          override.rules[rule.metadata.id] as RuleConfig<TOptions> | undefined,
        );
      }
    }
  }

  if (
    path &&
    artifacts &&
    rule.metadata.ignoreGeneratedArtifacts &&
    artifacts.isGenerated(path) &&
    !(isObject(resolved.options) && resolved.options.includeGenerated === true)
  )
    return { ...resolved, enabled: false };
  return resolved;
}

function matchesOverride(
  path: string,
  override: QualityGateOverride,
  kind: "file" | "directory",
): boolean {
  let candidate = path;
  if (override.directory !== undefined || override.scope !== undefined) {
    const directory = override.directory ?? ".";
    if (
      typeof directory !== "string" ||
      posix.isAbsolute(directory) ||
      /[\\:\0]/.test(directory) ||
      directory.split("/").includes("..")
    )
      throw new Error(
        "Override directory must be a project-relative path using '/'.",
      );
    if (
      override.scope !== undefined &&
      !["self", "subtree"].includes(override.scope)
    )
      throw new Error("Override scope must be self or subtree.");
    const relative = posix.relative(directory || ".", path);
    if (relative === ".." || relative.startsWith("../")) return false;
    if (relative === "" && kind === "file") return false;
    if (
      override.scope === "self" &&
      (kind === "directory"
        ? relative !== ""
        : relative === "" || posix.dirname(relative) !== ".")
    )
      return false;
    candidate = relative || ".";
  }
  const matches = (patterns: string[]) =>
    matchesAnyGlob(candidate, patterns) ||
    (kind === "directory" &&
      matchesAnyGlob(candidate === "." ? "" : `${candidate}/`, patterns));
  return (
    matches(override.files ?? ["**"]) && !matches(override.excludedFiles ?? [])
  );
}

function mergeRuleConfig<TOptions>(
  severity: DiagnosticSeverity | "off",
  options: TOptions,
  value: RuleConfig<TOptions> | undefined,
): ResolvedRuleConfig<TOptions> {
  if (value === undefined) {
    return {
      enabled: severity !== "off",
      severity: severityValue(severity),
      options,
    };
  }

  const nextSeverity = Array.isArray(value) ? value[0] : value;
  const nextOptions = Array.isArray(value) ? value[1] : undefined;
  return {
    enabled: nextSeverity !== "off",
    severity: severityValue(nextSeverity),
    options: mergeOptions(options, nextOptions),
  };
}

function mergeOptions<TOptions>(
  base: TOptions,
  next: TOptions | undefined,
): TOptions {
  if (isObject(base) && isObject(next)) {
    return { ...base, ...next } as TOptions;
  }
  return next ?? base;
}

function severityValue(value: DiagnosticSeverity | "off"): DiagnosticSeverity {
  return value === "off" ? "error" : value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function matchesAnyGlob(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}
