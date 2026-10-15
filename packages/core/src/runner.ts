import { NoopRuleCacheStore } from "./cache.js";
import { resolveRuleConfig } from "./config.js";
import { NodeFileSystemProvider } from "./fs.js";
import { GitChangedProvider, GitIndexFileSystemProvider } from "./git.js";
import { NodeProcessProvider } from "./process.js";
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

  for (const rule of options.rules) {
    if (!rule.metadata.supports.includes(mode)) {
      continue;
    }

    const resolved = resolveRuleConfig(options.config, rule);
    if (!resolved.enabled) {
      continue;
    }

    const ruleDiagnostics = await rule.check({
      root: options.root,
      mode,
      changes,
      fs,
      process,
      options: resolved.options,
      severity: resolved.severity,
      resolveConfig: (path) => resolveRuleConfig(options.config, rule, path),
      cache: cacheStore.forRule(rule.metadata.id),
    });
    for (const diagnostic of ruleDiagnostics) {
      const pathConfig = diagnostic.path
        ? resolveRuleConfig(options.config, rule, diagnostic.path)
        : resolved;
      if (pathConfig.enabled) {
        diagnostics.push({ ...diagnostic, severity: pathConfig.severity });
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
