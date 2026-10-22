import { posix } from "node:path";
import {
  type Diagnostic,
  type FilePresenceCondition,
  matchesAnyGlob,
  type Rule,
  type RuleContext,
} from "@slop-lab/qg-core";

interface RequiredFile {
  name: string;
  validate?: (content: string) => boolean;
  expected?: string;
}

export const requireReadmeRule: Rule = {
  metadata: {
    id: "repo/require-readme",
    name: "Require root README",
    description: "Requires README.md at the QG repository root.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "repo",
    requires: ["directoryListings"],
    fixable: "suggestion",
  },
  check: (context) =>
    checkFiles(context, requireReadmeRule.metadata.id, ".", [
      { name: "README.md" },
    ]),
};

export const requireGitattributesRule: Rule = {
  metadata: {
    id: "repo/require-gitattributes",
    name: "Require root LF attributes",
    description:
      "Requires root .gitattributes with a universal text=auto eol=lf baseline.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "repo",
    requires: ["directoryListings", "fileContent"],
    fixable: "suggestion",
  },
  check: (context) =>
    checkFiles(context, requireGitattributesRule.metadata.id, ".", [
      {
        name: ".gitattributes",
        validate: hasLfBaseline,
        expected: "* text=auto eol=lf",
      },
    ]),
};

export interface RequiredCompanionPolicy {
  /** Require these filenames when the neighboring-file condition matches. */
  when: FilePresenceCondition;
  files: string[];
}

export interface RequiredCompanionsOptions {
  policies?: RequiredCompanionPolicy[];
  /** Root-relative directory globs; '.' represents the repository root. */
  directories?: string[];
  ignoredDirectories?: string[];
}

const ignoredDirectories = [".git", ".local", ".qg", "node_modules", "dist"];

/** Reusable conditional file policies, independent of any particular ecosystem. */
export const requiredCompanionsRule: Rule<RequiredCompanionsOptions> = {
  metadata: {
    id: "files/required-companions",
    name: "Require companion files",
    description:
      "Requires companion files in directories matching nearby file conditions. Explicit opt-in required.",
    defaultSeverity: "error",
    defaultEnabled: false,
    supports: ["changed", "full"],
    scope: "directory",
    requires: ["directoryListings"],
    fixable: "suggestion",
    defaultOptions: { policies: [], directories: ["**"], ignoredDirectories },
  },
  async check(context) {
    const diagnostics: Diagnostic[] = [];
    for (const directory of await candidateDirectories(context)) {
      const options = context.resolveConfig(directory, "directory").options;
      if (
        !matchesAnyGlob(directory, options.directories ?? ["**"]) ||
        !(await context.fs.isDirectory(directory))
      )
        continue;
      for (const policy of options.policies ?? []) {
        if (!Array.isArray(policy.files) || policy.files.length === 0)
          throw new Error(
            "files/required-companions: policy.files must be a non-empty filename list.",
          );
        for (const name of policy.files) validateFilename(name);
        if (!(await context.discovery.matches(policy.when, directory)))
          continue;
        diagnostics.push(
          ...(await checkFiles(
            context,
            requiredCompanionsRule.metadata.id,
            directory,
            policy.files.map((name) => ({ name })),
          )),
        );
      }
    }
    return [
      ...new Map(
        diagnostics.map((diagnostic) => [diagnostic.path, diagnostic]),
      ).values(),
    ];
  },
};

export const repositoryFileRules = [
  requireReadmeRule,
  requireGitattributesRule,
];

async function checkFiles(
  context: RuleContext,
  ruleId: string,
  directory: string,
  requirements: RequiredFile[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const requirement of requirements) {
    const path = posix.join(directory, requirement.name);
    const config = context.resolveConfig(path);
    if (!config.enabled) continue;
    const exists = await context.discovery.matches(
      { allOf: [requirement.name] },
      directory,
    );
    if (
      exists &&
      (!requirement.validate ||
        requirement.validate(await context.fs.readFile(path)))
    )
      continue;
    diagnostics.push({
      ruleId,
      severity: config.severity,
      path,
      scope: ruleId.startsWith("repo/") ? "repo" : "directory",
      message: exists
        ? `${path} must establish the universal baseline ${requirement.expected}.`
        : `Required file ${path} is missing.`,
      suggestedFix: {
        message: exists
          ? `Set ${requirement.expected} in ${path}; retain intentional path-specific exceptions.`
          : `Add ${path}${requirement.expected ? ` containing ${requirement.expected}` : ""}.`,
      },
    });
  }
  return diagnostics;
}

/** Validate the explicit baseline, not Git's effective attributes for every path. */
function hasLfBaseline(content: string): boolean {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/[\t ]+/))
    .filter(([, ...attributes]) =>
      attributes.every((attribute) =>
        /^(?:[-!]?[\w][\w.-]*|[\w][\w.-]*=.*)$/.test(attribute),
      ),
    );
  const macros = new Map<string, string[]>([
    ["binary", ["-diff", "-merge", "-text"]],
  ]);
  for (const [pattern, ...attributes] of lines) {
    if (pattern?.startsWith("[attr]")) macros.set(pattern.slice(6), attributes);
  }
  let text: string | undefined;
  let eol: string | undefined;
  const apply = (attribute: string, expanding = new Set<string>()) => {
    if (/^(?:[-!]text|text(?:=.*)?)$/.test(attribute)) text = attribute;
    if (/^(?:[-!]eol|eol(?:=.*)?)$/.test(attribute)) eol = attribute;
    const expansion = macros.get(attribute);
    if (expansion && !expanding.has(attribute)) {
      const nested = new Set(expanding).add(attribute);
      for (const value of expansion) apply(value, nested);
    }
  };
  for (const [pattern, ...attributes] of lines) {
    if (!["*", '"*"', "**", '"**"', "**/*", '"**/*"'].includes(pattern ?? ""))
      continue;
    for (const attribute of attributes) apply(attribute);
  }
  return text === "text=auto" && eol === "eol=lf";
}

function validateFilename(name: string): void {
  if (
    typeof name !== "string" ||
    !name ||
    name === "." ||
    name === ".." ||
    /[/\\:*?\0]/.test(name)
  )
    throw new Error(
      "files/required-companions: files must contain literal filenames without directory separators.",
    );
}

async function candidateDirectories(
  context: RuleContext<RequiredCompanionsOptions>,
): Promise<string[]> {
  const ignored = context.options.ignoredDirectories ?? ignoredDirectories;
  const directories = new Set<string>(["."]);
  if (context.mode === "changed") {
    for (const change of context.changes) {
      for (const path of [change.path, change.oldPath]) {
        if (!path || path.split("/").some((part) => ignored.includes(part)))
          continue;
        let directory = posix.dirname(path);
        while (directory !== ".") {
          directories.add(directory);
          directory = posix.dirname(directory);
        }
      }
    }
  } else {
    for (const directory of directories) {
      for (const entry of await context.fs.readDirectory(directory))
        if (entry.type === "directory" && !ignored.includes(entry.name))
          directories.add(entry.path);
    }
  }
  return [...directories].sort();
}
