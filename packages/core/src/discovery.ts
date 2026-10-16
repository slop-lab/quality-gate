import { posix } from "node:path";
import { matchesAnyGlob } from "./config.js";
import type {
  FileDiscovery,
  FilePresenceCondition,
  FileSystemProvider,
  NearbyFileMatch,
} from "./types.js";

/** One instance per scan, using the same filesystem snapshot as rule execution. */
export class NearbyFileDiscovery implements FileDiscovery {
  private readonly listings = new Map<string, Promise<string[]>>();

  constructor(private readonly fs: FileSystemProvider) {}

  async matches(
    condition: FilePresenceCondition,
    directory = ".",
  ): Promise<boolean> {
    validateCondition(condition);
    const directories = ancestors(directory, condition.search === "ancestors");
    const names = (
      await Promise.all(directories.map((path) => this.files(path)))
    ).flat();
    const present = (pattern: string) =>
      names.some((name) => matchesAnyGlob(name, [pattern]));
    return (
      (condition.allOf ?? []).every(present) &&
      (condition.anyOf === undefined || condition.anyOf.some(present)) &&
      !(condition.noneOf ?? []).some(present)
    );
  }

  async findNearest(
    patterns: string[],
    directory = ".",
  ): Promise<NearbyFileMatch | undefined> {
    validatePatterns(patterns);
    for (const candidate of ancestors(directory, true)) {
      const paths = (await this.files(candidate))
        .filter((name) => matchesAnyGlob(name, patterns))
        .map((name) => posix.join(candidate, name));
      if (paths.length) return { directory: candidate, paths };
    }
    return undefined;
  }

  private files(directory: string): Promise<string[]> {
    let listing = this.listings.get(directory);
    if (!listing) {
      listing = (async () => {
        if (!(await this.fs.isDirectory(directory))) return [];
        return (await this.fs.readDirectory(directory))
          .filter((entry) => entry.type === "file")
          .map((entry) => entry.name)
          .sort();
      })();
      this.listings.set(directory, listing);
    }
    return listing;
  }
}

function ancestors(directory: string, includeParents: boolean): string[] {
  if (
    typeof directory !== "string" ||
    directory.includes("\\") ||
    directory.includes(":") ||
    posix.isAbsolute(directory) ||
    directory.split("/").includes("..")
  )
    throw new Error(
      "Discovery directory must be a project-relative path without '..'.",
    );
  const paths = [posix.normalize(directory || ".")];
  while (includeParents && paths[paths.length - 1] !== ".")
    paths.push(posix.dirname(paths[paths.length - 1] ?? "."));
  return paths;
}

function validateCondition(condition: FilePresenceCondition): void {
  if (!condition || typeof condition !== "object" || Array.isArray(condition))
    throw new Error(
      "File condition must be an object containing allOf, anyOf, or noneOf.",
    );
  for (const key of Object.keys(condition))
    if (!["allOf", "anyOf", "noneOf", "search"].includes(key))
      throw new Error(`Unknown file condition field: ${key}.`);
  if (
    condition.search !== undefined &&
    !["directory", "ancestors"].includes(condition.search)
  )
    throw new Error("File condition search must be directory or ancestors.");
  for (const patterns of [condition.allOf, condition.anyOf, condition.noneOf])
    if (patterns !== undefined) validatePatterns(patterns);
}

function validatePatterns(patterns: string[]): void {
  if (
    !Array.isArray(patterns) ||
    patterns.some(
      (pattern) =>
        typeof pattern !== "string" ||
        !pattern ||
        pattern === "." ||
        pattern === ".." ||
        /[/\\:\0]/.test(pattern),
    )
  )
    throw new Error(
      "File conditions require filename globs without directory separators.",
    );
}
