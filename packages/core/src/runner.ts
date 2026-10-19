import { NoopRuleCacheStore } from "./cache.js";
import { resolveRuleConfig } from "./config.js";
import { NearbyFileDiscovery } from "./discovery.js";
import { NodeFileSystemProvider } from "./fs.js";
import { GitChangedProvider, GitIndexFileSystemProvider } from "./git.js";
import { NodeProcessProvider } from "./process.js";
import { DocumentSuppressions } from "./suppression.js";
import type { Diagnostic, RunOptions, RunResult, ScanMode } from "./types.js";

export async function runQualityGate(options: RunOptions): Promise<RunResult> {
  const mode = resolveMode(options);
  const fs =
    options.fs ??
    (options.staged
      ? new GitIndexFileSystemProvider(options.root)
      : new NodeFileSystemProvider(options.root));
  const process = options.process ?? new NodeProcessProvider();
  const changedProvider = options.changedProvider ?? new GitChangedProvider();
  const cacheStore = options.cacheStore ?? new NoopRuleCacheStore();
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
  const suppressions = new Map<string, DocumentSuppressions>();
  const discovery = new NearbyFileDiscovery(fs);
  const artifacts = new GeneratedArtifactRegistry(
    [
      ...options.rules.flatMap(
        (rule) => rule.metadata.generatedArtifacts ?? [],
      ),
      ...(options.generatedArtifacts ?? []),
    ],
    options.config?.artifacts?.generated,
  );

  for (const rule of options.rules) {
    if (!rule.metadata.supports.includes(mode)) {
      continue;
    }

    const resolved = resolveRuleConfig(options.config, rule);
    if (
      !resolved.enabled &&
      !options.config?.overrides?.some((override) => {
        const value = override.rules[rule.metadata.id];
        return (
          value !== undefined &&
          (Array.isArray(value)
            ? value[0]
            : typeof value === "string"
              ? value
              : value.severity) !== "off"
        );
      })
    ) {
      continue;
    }

    if (rule.metadata.when && !(await discovery.matches(rule.metadata.when)))
      continue;

    const ruleDiagnostics = await rule.check({
      root: options.root,
      mode,
      changes,
      fs,
      process,
      options: resolved.options,
      severity: resolved.severity,
      resolveConfig: (path, kind) =>
        resolveRuleConfig(options.config, rule, path, artifacts, kind),
      cache: cacheStore.forRule(rule.metadata.id),
      discovery,
      artifacts,
    });
    for (const diagnostic of ruleDiagnostics) {
      const pathConfig = diagnostic.path
        ? resolveRuleConfig(
            options.config,
            rule,
            diagnostic.path,
            artifacts,
            diagnostic.pathKind,
          )
        : resolved;
      if (pathConfig.enabled) {
        if (
          diagnostic.path &&
          diagnostic.line !== undefined &&
          diagnostic.suppressible !== false
        ) {
          let document = suppressions.get(diagnostic.path);
          if (!document && (await fs.isFile(diagnostic.path))) {
            document = new DocumentSuppressions(
              await fs.readFile(diagnostic.path),
            );
            suppressions.set(diagnostic.path, document);
          }
          if (document?.isSuppressed(diagnostic)) continue;
        }
        const levels = { info: 0, warning: 1, error: 2 };
        const severity =
          rule.metadata.preserveDiagnosticSeverity &&
          levels[diagnostic.severity] < levels[pathConfig.severity]
            ? diagnostic.severity
            : pathConfig.severity;
        diagnostics.push({
          ...diagnostic,
          severity,
          message: pathConfig.message ?? diagnostic.message,
        });
      }
    }
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

import { GeneratedArtifactRegistry } from "./artifacts.js";
