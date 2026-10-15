import { matchesAnyGlob, type RuleContext } from "@slop-lab/qg-core";

export const markdownExtensions = [".md", ".markdown", ".mdx"];
const ignoredDirectories = new Set([
  ".git",
  ".local",
  ".qg",
  "node_modules",
  "dist",
]);

export interface DocumentFileOptions {
  extensions?: string[];
  ignoredPaths?: string[];
}

export function isDocumentPath(
  path: string,
  options: DocumentFileOptions,
): boolean {
  return (
    !path.split("/").some((part) => ignoredDirectories.has(part)) &&
    (options.extensions ?? markdownExtensions).some((extension) =>
      path.toLowerCase().endsWith(extension.toLowerCase()),
    ) &&
    !matchesAnyGlob(path, options.ignoredPaths ?? [])
  );
}

export async function documentPaths(context: RuleContext): Promise<string[]> {
  if (context.mode === "changed") {
    return [
      ...new Set(
        context.changes
          .filter((change) => change.status !== "deleted")
          .map((change) => change.path),
      ),
    ].sort();
  }
  const paths: string[] = [];
  const pending = ["."];
  while (pending.length > 0) {
    const directory = pending.shift();
    if (!directory) continue;
    for (const entry of await context.fs.readDirectory(directory)) {
      if (entry.type === "directory" && !ignoredDirectories.has(entry.name))
        pending.push(entry.path);
      else if (entry.type === "file") paths.push(entry.path);
    }
  }
  return paths.sort();
}
