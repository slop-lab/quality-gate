import { posix } from "node:path";
import {
  type Diagnostic,
  type GeneratedArtifactRuleOptions,
  matchesAnyGlob,
  type Rule,
  type RuleContext,
} from "@slop-lab/qg-core";

export interface MaxFilesPerDirectoryOptions
  extends GeneratedArtifactRuleOptions {
  warningLimit?: number;
  limit?: number;
  ignoredPaths?: string[];
  ignoredDirectories?: string[];
}

const defaults: Required<MaxFilesPerDirectoryOptions> = {
  warningLimit: 50,
  limit: 100,
  ignoredPaths: [],
  ignoredDirectories: [".git", ".local", ".qg", "node_modules", "dist"],
  includeGenerated: false,
};

export const maxFilesPerDirectoryRule: Rule<MaxFilesPerDirectoryOptions> = {
  metadata: {
    id: "files/max-files-per-directory",
    name: "Maximum files per directory",
    description:
      "Warns above 50 direct files and errors above 100 direct files per directory.",
    defaultSeverity: "error",
    preserveDiagnosticSeverity: true,
    supports: ["changed", "full"],
    scope: "directory",
    requires: ["directoryListings", "gitChanges"],
    fixable: "suggestion",
    defaultOptions: defaults,
  },
  async check(context) {
    const diagnostics: Diagnostic[] = [];
    const pending =
      context.mode === "changed" ? changedDirectories(context) : ["."];
    const globallyIgnored =
      context.options.ignoredDirectories ?? defaults.ignoredDirectories;
    for (const directory of pending) {
      const resolved = context.resolveConfig(directory, "directory");
      const options = { ...defaults, ...resolved.options };
      if (
        directory.split("/").some((part) => globallyIgnored.includes(part)) ||
        !(await context.fs.isDirectory(directory))
      )
        continue;
      const entries = await context.fs.readDirectory(directory);
      // Keep traversing disabled directories: a descendant may opt back in.
      if (context.mode === "full")
        for (const entry of entries)
          if (entry.type === "directory") pending.push(entry.path);
      if (
        !resolved.enabled ||
        directory
          .split("/")
          .some((part) => options.ignoredDirectories.includes(part)) ||
        matchesAnyGlob(directory, options.ignoredPaths) ||
        matchesAnyGlob(`${directory}/`, options.ignoredPaths)
      )
        continue;
      for (const [name, value] of [
        ["warningLimit", options.warningLimit],
        ["limit", options.limit],
      ] as const)
        if (!Number.isSafeInteger(value) || value < 0)
          throw new Error(
            `files/max-files-per-directory: ${name} must be a non-negative integer.`,
          );
      const count = entries.filter(
        (entry) =>
          entry.type === "file" &&
          !matchesAnyGlob(entry.path, options.ignoredPaths) &&
          (options.includeGenerated ||
            !context.artifacts.isGenerated(entry.path)),
      ).length;
      const severity =
        count > options.limit
          ? "error"
          : count > options.warningLimit
            ? "warning"
            : undefined;
      if (!severity) continue;
      const limit = severity === "error" ? options.limit : options.warningLimit;
      diagnostics.push({
        ruleId: maxFilesPerDirectoryRule.metadata.id,
        severity,
        path: directory,
        pathKind: "directory",
        scope: "directory",
        message: `Directory has ${count} direct files; ${severity} threshold is ${limit}.`,
        metadata: { fileCount: count },
        suggestedFix: {
          message:
            "Group related files into subdirectories or configure a directory-specific limit.",
        },
      });
    }
    return diagnostics.sort((left, right) =>
      (left.path ?? "").localeCompare(right.path ?? ""),
    );
  },
};

function changedDirectories(
  context: RuleContext<MaxFilesPerDirectoryOptions>,
): string[] {
  return [
    ...new Set(
      context.changes
        .flatMap((change) => [change.path, change.oldPath])
        .filter((path): path is string => Boolean(path))
        .map((path) => posix.dirname(path)),
    ),
  ].sort();
}
