#!/usr/bin/env node
import { cwd, exit } from "node:process";
import {
  type Diagnostic,
  runQualityGate,
  type ScanMode,
} from "@quality-gate/core";
import { fileRules } from "@quality-gate/rules-files";
import {
  noLoneGitkeepRule,
  noTrackedLocalFilesRule,
} from "@quality-gate/rules-git";
import { packageManagerRules } from "@quality-gate/rules-package-manager";
import { testRules } from "@quality-gate/rules-test";
import { loadConfig } from "./config.js";

interface CliOptions {
  command: "check" | "rules" | "help";
  mode?: ScanMode;
  base?: string;
  head?: string;
  staged?: boolean;
  workingTree?: boolean;
  format: "stylish" | "json";
  root: string;
  config?: string;
}

const builtInRules = [
  noLoneGitkeepRule,
  noTrackedLocalFilesRule,
  ...fileRules,
  ...packageManagerRules,
  ...testRules,
];

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv);

  if (options.command === "help") {
    printHelp();
    return 0;
  }

  if (options.command === "rules") {
    printRules(options.format);
    return 0;
  }

  const result = await runQualityGate({
    root: options.root,
    mode: options.mode,
    base: options.base,
    head: options.head,
    staged: options.staged,
    workingTree: options.workingTree,
    rules: builtInRules,
    config: await loadConfig(options.root, options.config),
  });

  if (options.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printStylish(result.diagnostics);
  }

  return result.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  )
    ? 1
    : 0;
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

  return options;
}

function readCommand(args: string[]): CliOptions["command"] {
  const first = args[0];
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

function printRules(format: "stylish" | "json"): void {
  const rules = builtInRules.map((rule) => rule.metadata);
  if (format === "json") {
    console.log(JSON.stringify(rules, null, 2));
    return;
  }

  for (const rule of rules) {
    console.log(`${rule.id} (${rule.defaultSeverity})`);
    console.log(`  ${rule.description}`);
  }
}

function printStylish(diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    console.log("No diagnostics.");
    return;
  }

  for (const diagnostic of diagnostics) {
    const location = diagnostic.path ? `${diagnostic.path}: ` : "";
    console.log(
      `${diagnostic.severity.toUpperCase()} ${location}${diagnostic.message} (${diagnostic.ruleId})`,
    );
  }
}

function printHelp(): void {
  console.log(`quality-gate

Usage:
  quality-gate check [--changed|--full] [--base <ref>] [--format stylish|json]
  quality-gate rules [--format stylish|json]

Options:
  --changed       Scan Git affected paths.
  --full          Scan the full workspace.
  --base <ref>    Base ref for changed scans.
  --head <ref>    Head ref for changed scans.
  --staged        Scan staged changes.
  --working-tree  Scan unstaged working tree changes.
  --root <path>   Workspace root. Defaults to cwd.
  --config <path> Root config path. Defaults to .qualitygate.yaml or .yml.
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
