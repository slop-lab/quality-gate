import {
  type Diagnostic,
  matchesAnyGlob,
  type Rule,
  type RuleContext,
} from "@slop-lab/qg-core";

export interface RequireTsCheckOptions {
  extensions?: string[];
  ignoredPaths?: string[];
  ignoredDirectories?: string[];
}

const defaults: Required<RequireTsCheckOptions> = {
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  ignoredPaths: [],
  ignoredDirectories: [".git", ".local", ".qg", "node_modules", "dist"],
};

export const requireTsCheckRule: Rule<RequireTsCheckOptions> = {
  metadata: {
    id: "js/require-ts-check",
    name: "Require JavaScript type checking",
    description:
      "Requires an effective leading // @ts-check directive in JavaScript files.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "file",
    requires: ["fileContent", "directoryListings"],
    fixable: "suggestion",
    defaultOptions: defaults,
  },
  async check(context) {
    const diagnostics: Diagnostic[] = [];
    for (const path of await candidatePaths(context)) {
      const resolved = context.resolveConfig(path);
      const options = { ...defaults, ...resolved.options };
      if (
        !resolved.enabled ||
        !isJavaScript(path, options) ||
        !(await context.fs.isFile(path))
      )
        continue;
      if (hasEffectiveTsCheck(await context.fs.readFile(path))) continue;
      diagnostics.push({
        ruleId: requireTsCheckRule.metadata.id,
        severity: resolved.severity,
        message:
          "JavaScript files must enable type checking with a leading // @ts-check directive; a later @ts-nocheck must not override it.",
        path,
        line: 1,
        column: 1,
        scope: "file",
        suggestedFix: {
          message:
            "Add // @ts-check before code (after any shebang), and remove or replace an overriding @ts-nocheck.",
        },
      });
    }
    return diagnostics;
  },
};

async function candidatePaths(
  context: RuleContext<RequireTsCheckOptions>,
): Promise<string[]> {
  if (context.mode === "changed") {
    return [
      ...new Set(
        context.changes
          .filter((change) => change.status !== "deleted")
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
      )
        pending.push(entry.path);
      else if (entry.type === "file") paths.push(entry.path);
    }
  }
  return paths.sort();
}

function isJavaScript(
  path: string,
  options: Required<RequireTsCheckOptions>,
): boolean {
  return (
    options.extensions.some((extension) =>
      path.toLowerCase().endsWith(extension.toLowerCase()),
    ) &&
    !path
      .split("/")
      .some((part) => options.ignoredDirectories.includes(part)) &&
    !matchesAnyGlob(path, options.ignoredPaths)
  );
}

/** Scan leading trivia only; never mistake a string or a body comment for a pragma. */
function hasEffectiveTsCheck(content: string): boolean {
  let offset = 0;
  let enabled = false;
  if (content.startsWith("#!")) {
    while (
      offset < content.length &&
      !/[\r\n\u2028\u2029]/.test(content[offset] ?? "")
    )
      offset += 1;
  }
  while (offset < content.length) {
    if (/\s/u.test(content[offset] ?? "")) {
      offset += 1;
      continue;
    }
    if (content.startsWith("//", offset)) {
      const start = offset;
      while (
        offset < content.length &&
        !/[\r\n\u2028\u2029]/.test(content[offset] ?? "")
      )
        offset += 1;
      const directive = /^\/\/\/?\s*@(ts-check|ts-nocheck)(?=\s|:|$)/i.exec(
        content.slice(start, offset),
      );
      if (directive) enabled = directive[1]?.toLowerCase() === "ts-check";
    } else if (content.startsWith("/*", offset)) {
      const end = content.indexOf("*/", offset + 2);
      if (end < 0) break;
      offset = end + 2;
    } else break;
  }
  return enabled;
}
