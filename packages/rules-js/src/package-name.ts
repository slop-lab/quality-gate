import {
  type Diagnostic,
  type GeneratedArtifactRuleOptions,
  matchesAnyGlob,
  type Rule,
  type RuleContext,
} from "@slop-lab/qg-core";

export interface AllowedPackageNameOptions
  extends GeneratedArtifactRuleOptions {
  /** Regular expressions matched against the entire package name. */
  allowedPatterns?: string[];
  ignoredPaths?: string[];
  ignoredDirectories?: string[];
}

const defaults: Required<AllowedPackageNameOptions> = {
  allowedPatterns: [],
  includeGenerated: false,
  ignoredPaths: [],
  ignoredDirectories: [".git", ".local", ".qg", "node_modules", "dist"],
};

export const allowedPackageNameRule: Rule<AllowedPackageNameOptions> = {
  metadata: {
    id: "package/allowed-name",
    name: "Allowed package name",
    description:
      "Restricts package.json names to configured regular expressions.",
    defaultSeverity: "error",
    defaultEnabled: false,
    supports: ["changed", "full"],
    scope: "file",
    requires: ["fileContent", "directoryListings"],
    fixable: "suggestion",
    defaultOptions: defaults,
    ignoreGeneratedArtifacts: true,
  },
  async check(context) {
    const diagnostics: Diagnostic[] = [];
    for (const path of await packagePaths(context)) {
      const resolved = context.resolveConfig(path);
      const options = { ...defaults, ...resolved.options };
      if (
        !resolved.enabled ||
        path
          .split("/")
          .some((part) => options.ignoredDirectories.includes(part)) ||
        matchesAnyGlob(path, options.ignoredPaths) ||
        !(await context.fs.isFile(path))
      )
        continue;

      const patterns = options.allowedPatterns.map((pattern) => {
        try {
          const expression = new RegExp(pattern);
          return new RegExp(`^(?:${expression.source})(?![\\s\\S])`);
        } catch {
          throw new Error(
            `package/allowed-name: invalid allowed pattern ${JSON.stringify(pattern)}.`,
          );
        }
      });
      let manifest: unknown;
      try {
        manifest = JSON.parse(await context.fs.readFile(path));
      } catch {
        diagnostics.push({
          ruleId: allowedPackageNameRule.metadata.id,
          severity: resolved.severity,
          message:
            "Cannot validate package name: package.json is not valid JSON.",
          path,
          scope: "file",
        });
        continue;
      }
      const name =
        manifest && typeof manifest === "object" && "name" in manifest
          ? manifest.name
          : undefined;
      if (
        typeof name === "string" &&
        name.length > 0 &&
        patterns.some((pattern) => pattern.test(name))
      )
        continue;
      diagnostics.push({
        ruleId: allowedPackageNameRule.metadata.id,
        severity: resolved.severity,
        message: `Package name ${JSON.stringify(name) ?? "(missing)"} must match one of the allowed patterns: ${options.allowedPatterns.join(", ") || "(none configured)"}.`,
        path,
        scope: "file",
        suggestedFix: {
          message:
            "Set package.json name to a name matching an allowed pattern.",
        },
      });
    }
    return diagnostics;
  },
};

async function packagePaths(
  context: RuleContext<AllowedPackageNameOptions>,
): Promise<string[]> {
  const isManifest = (path: string) =>
    path === "package.json" || path.endsWith("/package.json");
  if (context.mode === "changed") {
    return [
      ...new Set(
        context.changes
          .filter(
            (change) => change.status !== "deleted" && isManifest(change.path),
          )
          .map((change) => change.path),
      ),
    ].sort();
  }
  const options = { ...defaults, ...context.options };
  const paths: string[] = [];
  const pending = ["."];
  while (pending.length > 0) {
    const directory = pending.shift();
    if (!directory) continue;
    for (const entry of await context.fs.readDirectory(directory)) {
      if (
        entry.type === "directory" &&
        !options.ignoredDirectories.includes(entry.name)
      ) {
        pending.push(entry.path);
      } else if (entry.type === "file" && isManifest(entry.path)) {
        paths.push(entry.path);
      }
    }
  }
  return paths.sort();
}
