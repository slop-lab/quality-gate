import { NodeFileSystemProvider } from "./fs.js";
import { GitChangedProvider } from "./git.js";
import { NodeProcessProvider } from "./process.js";
import type {
  Diagnostic,
  DiagnosticSeverity,
  QualityGateConfig,
  Rule,
  RunOptions,
  RunResult,
  ScanMode,
} from "./types.js";

export async function runQualityGate(options: RunOptions): Promise<RunResult> {
  const mode = resolveMode(options);
  const fs = options.fs ?? new NodeFileSystemProvider(options.root);
  const process = options.process ?? new NodeProcessProvider();
  const changedProvider = options.changedProvider ?? new GitChangedProvider();
  const changes =
    mode === "changed"
      ? await changedProvider.getChanged({
          root: options.root,
          base: options.base ?? options.config?.scan?.base,
          head: options.head,
          staged: options.staged,
          workingTree: options.workingTree,
        })
      : [];

  const diagnostics: Diagnostic[] = [];

  for (const rule of options.rules) {
    if (!rule.metadata.supports.includes(mode)) {
      continue;
    }

    const resolved = resolveRuleConfig(options.config, rule);
    if (resolved.severity === "off") {
      continue;
    }

    diagnostics.push(
      ...(await rule.check({
        root: options.root,
        mode,
        changes,
        fs,
        process,
        options: resolved.ruleOptions,
        severity: resolved.severity,
      })),
    );
  }

  return {
    mode,
    changes,
    diagnostics,
  };
}

function resolveMode(options: RunOptions): ScanMode {
  return options.mode ?? options.config?.scan?.defaultMode ?? "changed";
}

function resolveRuleConfig(
  config: QualityGateConfig | undefined,
  rule: Rule,
): { severity: DiagnosticSeverity | "off"; ruleOptions: unknown } {
  const raw = config?.rules?.[rule.metadata.id];
  const defaultOptions = rule.metadata.defaultOptions ?? {};

  if (!raw) {
    return {
      severity: rule.metadata.defaultSeverity,
      ruleOptions: defaultOptions,
    };
  }

  if (Array.isArray(raw)) {
    return {
      severity: raw[0],
      ruleOptions: {
        ...(isObject(defaultOptions) ? defaultOptions : {}),
        ...(isObject(raw[1]) ? raw[1] : {}),
      },
    };
  }

  return {
    severity: raw,
    ruleOptions: defaultOptions,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
