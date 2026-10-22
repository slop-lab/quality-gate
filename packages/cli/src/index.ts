#!/usr/bin/env node
import { cwd, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { runChecks } from "@slop-lab/qg-check-runner";
import {
  type Diagnostic,
  JsonFileRuleCacheStore,
  type Rule,
  type RuleCacheStore,
  type RunResult,
  runQualityGate,
  type ScanMode,
} from "@slop-lab/qg-core";
import { loadConfig } from "./config.js";
import { daemonDirectory, requestDaemon, startDaemon } from "./daemon.js";
import { inspectPreCommitHook, installHooks } from "./hooks.js";
import { loadRules } from "./rule-sets.js";

interface CliOptions {
  command: "check" | "run-hook" | "rules" | "help";
  mode?: ScanMode;
  base?: string;
  head?: string;
  staged?: boolean;
  workingTree?: boolean;
  rulesOnly?: boolean;
  format: "stylish" | "json";
  root: string;
  config?: string;
}

async function main(argv: string[]): Promise<number> {
  const special = await runSpecialCommand(argv);
  if (special !== undefined) return special;
  const options = parseArgs(argv);

  if (options.command === "help") {
    printHelp();
    return 0;
  }

  await checkSetup(options.root, options.config);

  if (options.command === "rules") {
    const config = await loadConfig(options.root, options.config);
    printRules(await loadRules(options.root, config), options.format);
    return 0;
  }

  // The daemon runs rule scans; command/test checks run once in this client.
  const checkArgs =
    options.command === "run-hook"
      ? ["check", ...argv.slice(2), "--staged"]
      : argv;
  const remote = await requestDaemon(options.root, "check", checkArgs);
  if (remote?.error) throw new Error(remote.error);
  const result = remote?.result ?? (await executeCheck(options));
  if (!options.rulesOnly) {
    const config = await loadConfig(options.root, options.config);
    result.diagnostics.push(
      ...(await runChecks(options.root, [
        ...(config?.checks ?? []),
        ...(options.command === "run-hook"
          ? (config?.hooks?.preCommit?.checks ?? [])
          : []),
      ])),
    );
  }
  printResult(result, options.format);
  return exitCodeFor(result);
}

async function checkSetup(root: string, configPath?: string): Promise<void> {
  const config = await loadConfig(root, configPath);
  const policy = config?.hooks?.preCommit?.installation ?? "check";
  if (policy === "off") return;
  const cliPath = fileURLToPath(import.meta.url);
  const issue = await inspectPreCommitHook(root, cliPath);
  if (!issue) return;
  if (policy === "auto") {
    try {
      await installHooks(root, cliPath);
      return;
    } catch (error) {
      console.error(
        `QG setup warning: Cannot automatically install the pre-commit hook: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
  }
  console.error(
    `QG setup warning: ${issue} Run qg hooks install, or set hooks.preCommit.installation to auto or off.`,
  );
}

async function executeCheck(
  options: CliOptions,
  cacheStore?: RuleCacheStore,
): Promise<RunResult> {
  const config = await loadConfig(options.root, options.config);
  return runQualityGate({
    root: options.root,
    mode: options.mode,
    base: options.base,
    head: options.head,
    staged: options.staged,
    workingTree: options.workingTree,
    rules: await loadRules(options.root, config),
    config,
    cacheStore,
  });
}

function printResult(result: RunResult, format: CliOptions["format"]): void {
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printStylish(result.diagnostics);
  }
}

function exitCodeFor(result: RunResult): number {
  return result.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? 1
    : 0;
}

async function runSpecialCommand(argv: string[]): Promise<number | undefined> {
  const command = argv[0];
  if (command === "hooks") {
    if (argv.includes("--help") || argv.includes("-h")) {
      console.log("Usage: qg hooks install [--root <path>] [--force]");
      return 0;
    }
    if (argv[1] !== "install")
      throw new Error("Usage: qg hooks install [--root <path>] [--force]");
    let root = cwd();
    let force = false;
    const args = argv.slice(2);
    for (let arg = args.shift(); arg !== undefined; arg = args.shift()) {
      if (arg === "--root") root = requireValue(arg, args);
      else if (arg === "--force") force = true;
      else throw new Error(`Unknown argument: ${arg}`);
    }
    const result = await installHooks(
      root,
      fileURLToPath(import.meta.url),
      force,
    );
    console.log("OK");
    if (result.backup)
      console.log(`Previous hook backed up to ${result.backup}.`);
    return 0;
  }
  if (command !== "daemon" && command !== "cache") return undefined;
  const rootIndex = argv.indexOf("--root");
  const root =
    rootIndex >= 0 && argv[rootIndex + 1] ? argv[rootIndex + 1] : cwd();
  await checkSetup(root);
  if (command === "daemon") {
    const action = argv[1] ?? "status";
    if (action === "start") {
      const store = new JsonFileRuleCacheStore(joinCache(root));
      await startDaemon(root, async (args) => {
        const options = parseArgs(args);
        const result = await executeCheck(options, store);
        return { code: exitCodeFor(result), result };
      });
      return 0;
    }
    const response = await requestDaemon(
      root,
      action === "stop" ? "stop" : "ping",
    );
    console.log(
      response
        ? action === "stop"
          ? "OK"
          : "qg daemon running"
        : "qg daemon is not running",
    );
    return response ? 0 : 1;
  }
  if (argv[1] !== "clear" || argv[2] !== "--rule" || !argv[3]) {
    throw new Error("Usage: qg cache clear --rule <rule-id>");
  }
  await new JsonFileRuleCacheStore(joinCache(root)).clearRule(argv[3]);
  console.log("OK");
  return 0;
}

function joinCache(root: string): string {
  return `${daemonDirectory(root)}/rules`;
}

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const command = readCommand(args);
  const options: CliOptions = {
    command,
    format: "stylish",
    root: cwd(),
    staged: true,
  };

  for (let arg = args.shift(); arg !== undefined; arg = args.shift()) {
    switch (arg) {
      case "--rules-only":
        options.rulesOnly = true;
        break;
      case "--changed":
        options.mode = "changed";
        options.staged = false;
        break;
      case "--full":
        options.mode = "full";
        options.staged = false;
        break;
      case "--base":
        options.base = requireValue(arg, args);
        break;
      case "--head":
        options.head = requireValue(arg, args);
        break;
      case "--staged":
        options.mode = "changed";
        options.workingTree = false;
        options.staged = true;
        break;
      case "--working-tree":
        options.workingTree = true;
        options.staged = false;
        break;
      case "--format": {
        const format = requireValue(arg, args);
        if (format !== "stylish" && format !== "json") {
          throw new Error(`Unsupported format: ${format}`);
        }
        options.format = format;
        break;
      }
      case "--root":
        options.root = requireValue(arg, args);
        break;
      case "--config":
        options.config = requireValue(arg, args);
        break;
      case "-h":
      case "--help":
        options.command = "help";
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (command === "run-hook") {
    if (options.rulesOnly)
      throw new Error("run-hook pre-commit does not support --rules-only");
    options.mode = "changed";
    options.staged = true;
    options.workingTree = false;
  }
  return options;
}

function readCommand(args: string[]): CliOptions["command"] {
  const first = args[0];
  if (first === "run-hook") {
    args.shift();
    if (args[0] === "--help" || args[0] === "-h") return "help";
    if (args.shift() !== "pre-commit")
      throw new Error(
        "Usage: qg run-hook pre-commit [--root <path>] [--config <path>] [--format stylish|json]",
      );
    return "run-hook";
  }
  if (first === "check" || first === "rules") {
    args.shift();
    return first;
  }

  if (!first || first.startsWith("-")) {
    return "check";
  }

  if (first === "help") {
    args.shift();
    return "help";
  }

  throw new Error(`Unknown command: ${first}`);
}

function requireValue(flag: string, args: string[]): string {
  const value = args.shift();
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printRules(loaded: Rule[], format: "stylish" | "json"): void {
  const rules = loaded.map((rule) => rule.metadata);
  if (format === "json") {
    console.log(JSON.stringify(rules, null, 2));
    return;
  }

  for (const rule of rules) {
    console.log(
      `${rule.id} (${rule.defaultEnabled === false ? "off" : rule.defaultSeverity})`,
    );
    console.log(`  ${rule.description}`);
  }
}

function printStylish(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const location = diagnostic.path ? `${diagnostic.path}: ` : "";
    console.log(
      `${diagnostic.severity.toUpperCase()} ${location}${diagnostic.message} (${diagnostic.ruleId})`,
    );
    if (diagnostic.ruleId.startsWith("checks/")) {
      for (const key of ["stdout", "stderr", "error"]) {
        const detail = diagnostic.metadata?.[key];
        if (typeof detail === "string" && detail.trim())
          console.log(detail.trim());
      }
    }
  }
  if (!diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    console.log("PASS");
}

function printHelp(): void {
  console.log(`qg

Usage:
  qg check [--rules-only] [--changed|--full] [--base <ref>] [--format stylish|json]
  qg rules [--format stylish|json]
  qg hooks install [--root <path>] [--force]
  qg run-hook pre-commit [--format stylish|json]
  qg daemon <start|status|stop>
  qg cache clear --rule <rule-id>

qg with no command is an alias for qg check. Both run rules and shared checks.

Options:
  --rules-only    Run rules without shared command/test checks.
  --changed       Scan Git affected paths.
  --full          Scan the full workspace.
  --base <ref>    Base ref for changed scans.
  --head <ref>    Head ref for changed scans.
  --staged        Scan staged changes (default).
  --working-tree  Scan unstaged working tree changes.
  --root <path>   Workspace root. Defaults to cwd.
  --config <path> Root config path. Defaults to .qg.yaml or .yml.
`);
}

main(process.argv.slice(2))
  .then((code) => {
    exitCode(code);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    exitCode(2);
  });

function exitCode(code: number): void {
  if (code !== 0) {
    exit(code);
  }
}
