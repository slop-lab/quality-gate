import type {
  ChangeEntry,
  Diagnostic,
  DiagnosticSeverity,
  Rule,
  RuleContext,
  RuleMetadata,
  ScanMode,
} from "./types.js";

/** Execution data that a provider can encode for its own IPC/network protocol. */
export interface RuleExecutionRequest<TOptions = unknown> {
  ruleId: string;
  root: string;
  mode: ScanMode;
  changes: ChangeEntry[];
  options: TOptions;
  severity: DiagnosticSeverity;
}

/** Host services are separate from execution data; they are not JSON values. */
export type RuleExecutionServices<TOptions = unknown> = Pick<
  RuleContext<TOptions>,
  "fs" | "process" | "resolveConfig" | "cache" | "discovery" | "artifacts"
>;

export interface RuleExecutionResult {
  diagnostics: Diagnostic[];
}

/** Implement execution with an in-process call, subprocess, daemon, or other transport. */
export interface RuleExecutor<TOptions = unknown> {
  execute(
    request: RuleExecutionRequest<TOptions>,
    services: RuleExecutionServices<TOptions>,
  ): Promise<RuleExecutionResult>;
}

/** A provider discovers rule metadata and delegates execution independently. */
export interface RuleProvider<TOptions = unknown>
  extends RuleExecutor<TOptions> {
  getRules():
    | readonly RuleMetadata<TOptions>[]
    | Promise<readonly RuleMetadata<TOptions>[]>;
}

export function isRuleProvider(value: unknown): value is RuleProvider {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as RuleProvider).getRules === "function" &&
    typeof (value as RuleProvider).execute === "function"
  );
}

export function isRuleMetadata(value: unknown): value is RuleMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as RuleMetadata;
  return (
    typeof metadata.id === "string" &&
    !!metadata.id.trim() &&
    typeof metadata.name === "string" &&
    typeof metadata.description === "string" &&
    ["error", "warning", "info"].includes(metadata.defaultSeverity) &&
    (metadata.defaultEnabled === undefined ||
      typeof metadata.defaultEnabled === "boolean") &&
    Array.isArray(metadata.supports) &&
    metadata.supports.length > 0 &&
    metadata.supports.every((mode) => mode === "changed" || mode === "full") &&
    ["file", "directory", "package", "repo"].includes(metadata.scope) &&
    Array.isArray(metadata.requires) &&
    metadata.requires.every((input) => typeof input === "string") &&
    ["none", "suggestion", "edit"].includes(metadata.fixable)
  );
}

/** Adapt a provider to ordinary rules usable by the CLI or runQualityGate. */
export async function createRulesFromProvider<TOptions = unknown>(
  provider: RuleProvider<TOptions>,
): Promise<Rule<TOptions>[]> {
  if (!isRuleProvider(provider))
    throw new Error("Rule provider must implement getRules() and execute().");
  const metadata = await provider.getRules();
  if (
    !Array.isArray(metadata) ||
    metadata.some((item) => !isRuleMetadata(item))
  )
    throw new Error(
      "Rule provider getRules() must return an array of valid rule metadata.",
    );
  const ids = new Set<string>();
  return metadata.map((item) => {
    if (ids.has(item.id)) throw new Error(`Duplicate rule ID: ${item.id}`);
    ids.add(item.id);
    return {
      metadata: item,
      async check(context) {
        const { root, mode, changes, options, severity, ...services } = context;
        const result = await provider.execute(
          { ruleId: item.id, root, mode, changes, options, severity },
          services,
        );
        if (
          !result ||
          !Array.isArray(result.diagnostics) ||
          result.diagnostics.some(
            (diagnostic) => !isDiagnosticFor(diagnostic, item.id),
          )
        )
          throw new Error(
            `Rule provider execute(${item.id}) must return diagnostics with the matching ruleId, message, severity, and scope.`,
          );
        return result.diagnostics;
      },
    };
  });
}

/** Expose existing in-process rules through the same provider contract. */
export function createRuleProvider<TOptions = unknown>(
  rules: readonly Rule<TOptions>[],
): RuleProvider<TOptions> {
  const byId = new Map<string, Rule<TOptions>>();
  for (const rule of rules) {
    if (byId.has(rule.metadata.id))
      throw new Error(`Duplicate rule ID: ${rule.metadata.id}`);
    byId.set(rule.metadata.id, rule);
  }
  return {
    getRules: () => rules.map((rule) => rule.metadata),
    async execute(request, services) {
      const rule = byId.get(request.ruleId);
      if (!rule) throw new Error(`Unknown provider rule: ${request.ruleId}`);
      const { ruleId: _, ...data } = request;
      return { diagnostics: await rule.check({ ...data, ...services }) };
    },
  };
}

function isDiagnosticFor(value: unknown, ruleId: string): value is Diagnostic {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as Diagnostic;
  return (
    diagnostic.ruleId === ruleId &&
    typeof diagnostic.message === "string" &&
    ["error", "warning", "info"].includes(diagnostic.severity) &&
    ["file", "directory", "package", "repo"].includes(diagnostic.scope) &&
    (diagnostic.path === undefined || typeof diagnostic.path === "string")
  );
}
