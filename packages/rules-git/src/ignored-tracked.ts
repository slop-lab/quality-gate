import { type Diagnostic, matchesAnyGlob, type Rule } from "@slop-lab/qg-core";

export interface NoIgnoredTrackedFilesOptions {
  ignoredPaths?: string[];
}

const defaultOptions: Required<NoIgnoredTrackedFilesOptions> = {
  ignoredPaths: [],
};

export const noIgnoredTrackedFilesRule: Rule<NoIgnoredTrackedFilesOptions> = {
  metadata: {
    id: "git/no-ignored-tracked-files",
    name: "No ignored tracked files",
    description: "Reports Git-tracked files matched by ignore rules.",
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
      args: ["ls-files", "-ci", "--exclude-standard", "-z"],
      cwd: context.root,
    });
    if (result.exitCode !== 0)
      throw new Error(`git ls-files failed: ${result.stderr.trim()}`);

    const diagnostics: Diagnostic[] = [];
    for (const path of result.stdout.split("\0").filter(Boolean)) {
      if (matchesAnyGlob(path, options.ignoredPaths)) continue;
      diagnostics.push({
        ruleId: noIgnoredTrackedFilesRule.metadata.id,
        severity: context.severity,
        message: "Git-ignored file is still tracked.",
        path,
        scope: "file",
        suggestedFix: {
          message: `Remove ${path} from the Git index or narrow the matching ignore pattern.`,
        },
      });
    }
    return diagnostics;
  },
};
