import type {
  Diagnostic,
  GeneratedArtifactRuleOptions,
  Rule,
  RuleContext,
} from "@slop-lab/qg-core";
import ts from "typescript";

export interface NoDirectoryFixtureCopyOptions
  extends GeneratedArtifactRuleOptions {
  ignoredDirectories?: string[];
  testFileSuffixes?: string[];
}

const defaultOptions: Required<NoDirectoryFixtureCopyOptions> = {
  ignoredDirectories: [".git", "dist", "node_modules"],
  includeGenerated: false,
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
    ignoreGeneratedArtifacts: true,
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
      if (
        !context.resolveConfig(path).enabled ||
        !(await context.fs.isFile(path))
      )
        continue;
      const content = await context.fs.readFile(path);
      for (const location of findCalls(content, path)) {
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

export const jsTestFixtureRules = [noDirectoryFixtureCopyRule];

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

function findCalls(content: string, path: string): Location[] {
  const source = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const locations: Location[] = [];
  const names = new Set(["createFixtureFromDirectory"]);
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@slop-lab/qg-rule-testing"
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        if (
          (element.propertyName ?? element.name).text ===
          "createFixtureFromDirectory"
        )
          names.add(element.name.text);
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee
        : ts.isPropertyAccessExpression(callee)
          ? callee.name
          : undefined;
      if (name && names.has(name.text)) {
        const position = source.getLineAndCharacterOfPosition(
          name.getStart(source),
        );
        locations.push({
          line: position.line + 1,
          column: position.character + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return locations;
}
