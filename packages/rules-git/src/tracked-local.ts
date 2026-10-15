import { type Diagnostic, matchesAnyGlob, type Rule } from "@quality-gate/core";

export interface NoTrackedLocalFilesOptions {
  directories?: string[];
  ignoredPaths?: string[];
}

const defaultOptions: Required<NoTrackedLocalFilesOptions> = {
  directories: [".local"],
  ignoredPaths: [],
};

export const noTrackedLocalFilesRule: Rule<NoTrackedLocalFilesOptions> = {
  metadata: {
    id: "git/no-tracked-local-files",
    name: "No tracked local files",
    description: "Reports Git-tracked files inside local-only directories.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "file",
    requires: ["process"],
    fixable: "suggestion",
    defaultOptions,
  },
  async check(context) {
    const options = { ...defaultOptions, ...context.options };
    const result = await context.process.exec({
      command: "git",
      args: ["ls-files", "-z"],
      cwd: context.root,
    });
    if (result.exitCode !== 0) {
      throw new Error(`git ls-files failed: ${result.stderr.trim()}`);
    }

    const diagnostics: Diagnostic[] = [];
    for (const path of result.stdout.split("\0").filter(Boolean)) {
      if (!isInForbiddenDirectory(path, options.directories)) continue;
      if (matchesAnyGlob(path, options.ignoredPaths)) continue;
      diagnostics.push({
        ruleId: noTrackedLocalFilesRule.metadata.id,
        severity: context.severity,
        message: "Local-only file is tracked by Git.",
        path,
        scope: "file",
        suggestedFix: {
          message: `Remove ${path} from the Git index and add the directory to .gitignore.`,
        },
      });
    }
    return diagnostics;
  },
};

function isInForbiddenDirectory(path: string, directories: string[]): boolean {
  const segments = path.split("/");
  return directories.some((directory) => segments.includes(directory));
}
