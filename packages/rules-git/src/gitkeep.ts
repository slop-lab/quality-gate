import { dirname } from "node:path/posix";
import type {
  Diagnostic,
  DirectoryEntry,
  Rule,
  RuleContext,
} from "@quality-gate/core";

export interface NoLoneGitkeepOptions {
  gitkeepName?: string;
  ignoreDirectories?: string[];
}

const defaultOptions: Required<NoLoneGitkeepOptions> = {
  gitkeepName: ".gitkeep",
  ignoreDirectories: [".git", "node_modules"],
};

export const noLoneGitkeepRule: Rule<NoLoneGitkeepOptions> = {
  metadata: {
    id: "gitkeep/no-lone-gitkeep",
    name: "No lone .gitkeep",
    description: "Reports directories that contain no files except .gitkeep.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "directory",
    requires: ["gitChanges", "directoryListings"],
    fixable: "edit",
    defaultOptions,
  },
  async check(context) {
    const options = {
      ...defaultOptions,
      ...context.options,
    };

    const directories =
      context.mode === "changed"
        ? collectAffectedDirectories(
            context.changes.flatMap((change) => [change.path, change.oldPath]),
          )
        : await collectAllDirectories(context, options);

    const diagnostics: Diagnostic[] = [];

    for (const directory of directories) {
      if (shouldIgnoreDirectory(directory, options.ignoreDirectories)) {
        continue;
      }

      if (!(await context.fs.isDirectory(directory))) {
        continue;
      }

      const entries = await context.fs.readDirectory(directory);
      if (containsOnlyGitkeep(entries, options.gitkeepName)) {
        const gitkeepPath =
          directory === "."
            ? options.gitkeepName
            : `${directory}/${options.gitkeepName}`;
        diagnostics.push({
          ruleId: noLoneGitkeepRule.metadata.id,
          severity: context.severity,
          message: `Directory contains no files except ${options.gitkeepName}.`,
          path: gitkeepPath,
          scope: "directory",
          suggestedFix: {
            message: `Delete ${gitkeepPath} or add a real file to the directory.`,
            edits: [
              {
                type: "deleteFile",
                path: gitkeepPath,
              },
            ],
          },
        });
      }
    }

    return diagnostics;
  },
};

export function collectAffectedDirectories(
  paths: Array<string | undefined>,
): string[] {
  const directories = new Set<string>();

  for (const path of paths) {
    if (!path) {
      continue;
    }

    const directory = dirname(path);
    directories.add(directory === "" ? "." : directory);
  }

  return [...directories].sort();
}

function containsOnlyGitkeep(
  entries: DirectoryEntry[],
  gitkeepName: string,
): boolean {
  return (
    entries.length === 1 &&
    entries[0]?.type === "file" &&
    entries[0].name === gitkeepName
  );
}

async function collectAllDirectories(
  context: RuleContext<NoLoneGitkeepOptions>,
  options: Required<NoLoneGitkeepOptions>,
): Promise<string[]> {
  const directories = new Set<string>(["."]);
  const pending = ["."];

  for (
    let directory = pending.shift();
    directory !== undefined;
    directory = pending.shift()
  ) {
    if (shouldIgnoreDirectory(directory, options.ignoreDirectories)) {
      continue;
    }

    if (!(await context.fs.isDirectory(directory))) {
      continue;
    }

    for (const entry of await context.fs.readDirectory(directory)) {
      if (entry.type !== "directory") {
        continue;
      }

      directories.add(entry.path);
      pending.push(entry.path);
    }
  }

  return [...directories].sort();
}

function shouldIgnoreDirectory(path: string, ignored: string[]): boolean {
  const segments = path.split("/");
  return ignored.some((ignore) => segments.includes(ignore));
}
