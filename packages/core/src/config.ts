import type {
  DiagnosticSeverity,
  QualityGateConfig,
  ResolvedRuleConfig,
  Rule,
  RuleConfig,
} from "./types.js";

export function resolveRuleConfig<TOptions>(
  config: QualityGateConfig | undefined,
  rule: Rule<TOptions>,
  path?: string,
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
      if (
        matchesAnyGlob(path, override.files) &&
        !matchesAnyGlob(path, override.excludedFiles ?? [])
      ) {
        resolved = mergeRuleConfig(
          resolved.enabled ? resolved.severity : "off",
          resolved.options,
          override.rules[rule.metadata.id] as RuleConfig<TOptions> | undefined,
        );
      }
    }
  }

  return resolved;
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
