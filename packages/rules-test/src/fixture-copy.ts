import type { Diagnostic, Rule, RuleContext } from "@quality-gate/core";

export interface NoDirectoryFixtureCopyOptions {
  ignoredDirectories?: string[];
  testFileSuffixes?: string[];
}

const defaultOptions: Required<NoDirectoryFixtureCopyOptions> = {
  ignoredDirectories: [".git", "dist", "node_modules"],
  testFileSuffixes: [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"],
};

export const noDirectoryFixtureCopyRule: Rule<NoDirectoryFixtureCopyOptions> = {
  metadata: {
    id: "test/no-directory-fixture-copy",
    name: "No directory fixture copy",
    description:
      "Reports tests that copy fixture directories instead of constructing focused fixtures.",
    defaultSeverity: "warning",
    supports: ["changed", "full"],
    scope: "file",
    requires: ["fileContent", "directoryListings"],
    fixable: "suggestion",
    defaultOptions,
  },
  async check(context) {
    const options = {
      ...defaultOptions,
      ...context.options,
    };
    const paths =
      context.mode === "changed"
        ? changedTestPaths(context, options)
        : await collectTestFiles(context, options);
    const diagnostics: Diagnostic[] = [];

    for (const path of paths) {
      const content = await context.fs.readFile(path);
      for (const location of findCalls(content, "createFixtureFromDirectory")) {
        diagnostics.push({
          ruleId: noDirectoryFixtureCopyRule.metadata.id,
          severity: context.severity,
          message:
            "Prefer focused createFixture data over copying a fixture directory.",
          path,
          line: location.line,
          column: location.column,
          scope: "file",
          suggestedFix: {
            message:
              "Inline only the files this test needs with createFixture(), or extract a small fixture factory.",
          },
        });
      }
    }

    return diagnostics;
  },
};

export const testRules = [noDirectoryFixtureCopyRule];

interface Location {
  line: number;
  column: number;
}

function changedTestPaths(
  context: RuleContext,
  options: Required<NoDirectoryFixtureCopyOptions>,
): string[] {
  const paths = new Set<string>();
  for (const change of context.changes) {
    for (const path of [change.path, change.oldPath]) {
      if (path && isTestFile(path, options)) {
        paths.add(path);
      }
    }
  }
  return [...paths].sort();
}

async function collectTestFiles(
  context: RuleContext,
  options: Required<NoDirectoryFixtureCopyOptions>,
): Promise<string[]> {
  const files: string[] = [];
  const pending = ["."];

  for (
    let directory = pending.shift();
    directory !== undefined;
    directory = pending.shift()
  ) {
    if (shouldIgnoreDirectory(directory, options.ignoredDirectories)) {
      continue;
    }

    for (const entry of await context.fs.readDirectory(directory)) {
      if (entry.type === "directory") {
        pending.push(entry.path);
      } else if (entry.type === "file" && isTestFile(entry.path, options)) {
        files.push(entry.path);
      }
    }
  }

  return files.sort();
}

function isTestFile(
  path: string,
  options: Required<NoDirectoryFixtureCopyOptions>,
): boolean {
  return options.testFileSuffixes.some((suffix) => path.endsWith(suffix));
}

function shouldIgnoreDirectory(path: string, ignored: string[]): boolean {
  const segments = path.split("/");
  return ignored.some((ignore) => segments.includes(ignore));
}

function findCalls(content: string, name: string): Location[] {
  const locations: Location[] = [];
  let line = 1;
  let column = 1;
  let index = 0;

  while (index < content.length) {
    if (
      content.startsWith(name, index) &&
      hasIdentifierBoundaries(content, index, name)
    ) {
      const openParenIndex = findNextNonWhitespace(
        content,
        index + name.length,
      );
      if (content[openParenIndex] === "(") {
        locations.push({ line, column });
      }
    }

    if (content[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    index += 1;
  }

  return locations;
}

function hasIdentifierBoundaries(
  content: string,
  index: number,
  name: string,
): boolean {
  return (
    !isIdentifierCharacter(content[index - 1]) &&
    !isIdentifierCharacter(content[index + name.length])
  );
}

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[$\w]/.test(character);
}

function findNextNonWhitespace(content: string, start: number): number {
  for (let index = start; index < content.length; index += 1) {
    if (!/\s/.test(content[index] ?? "")) {
      return index;
    }
  }
  return -1;
}
