import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ChangedProvider,
  type ChangeEntry,
  type Diagnostic,
  NodeFileSystemProvider,
  type ProcessProvider,
  type Rule,
  type RunResult,
  runQualityGate,
  type ScanMode,
} from "@slop-lab/qg-core";

export interface TestFixture {
  root: string;
  fs: NodeFileSystemProvider;
  changedProvider(changes: ChangeEntry[]): ChangedProvider;
  path(relativePath: string): string;
  read(relativePath: string): Promise<string>;
  write(relativePath: string, content: string): Promise<void>;
  cleanup(): Promise<void>;
}

export interface RunRuleOptions {
  fixture: TestFixture;
  rule: Rule;
  mode?: ScanMode;
  changes?: ChangeEntry[];
  process?: ProcessProvider;
}

export interface ExpectedDiagnostic {
  ruleId?: string;
  severity?: Diagnostic["severity"];
  message?: string | RegExp;
  path?: string;
  scope?: Diagnostic["scope"];
}

export async function createFixture(
  files: Record<string, string>,
): Promise<TestFixture> {
  const root = await mkFixtureRoot();

  for (const [path, content] of Object.entries(files)) {
    await writeFixtureFile(root, path, content);
  }

  return fixtureFromRoot(root);
}

export function runRule({
  fixture,
  rule,
  mode = "full",
  changes = [],
  process,
}: RunRuleOptions): Promise<RunResult> {
  return runQualityGate({
    root: fixture.root,
    mode,
    rules: [rule],
    changedProvider:
      mode === "changed" ? fixture.changedProvider(changes) : undefined,
    fs: fixture.fs,
    process,
  });
}

export function assertDiagnostic(
  diagnostic: Diagnostic | undefined,
  expected: ExpectedDiagnostic,
): asserts diagnostic is Diagnostic {
  if (!diagnostic) {
    throw new Error("Expected diagnostic, but received undefined.");
  }

  if (expected.ruleId !== undefined && diagnostic.ruleId !== expected.ruleId) {
    throw new Error(
      `Expected ruleId ${expected.ruleId}, received ${diagnostic.ruleId}.`,
    );
  }

  if (
    expected.severity !== undefined &&
    diagnostic.severity !== expected.severity
  ) {
    throw new Error(
      `Expected severity ${expected.severity}, received ${diagnostic.severity}.`,
    );
  }

  if (expected.message instanceof RegExp) {
    if (!expected.message.test(diagnostic.message)) {
      throw new Error(
        `Expected message to match ${expected.message}, received ${diagnostic.message}.`,
      );
    }
  } else if (
    expected.message !== undefined &&
    diagnostic.message !== expected.message
  ) {
    throw new Error(
      `Expected message ${expected.message}, received ${diagnostic.message}.`,
    );
  }

  if (expected.path !== undefined && diagnostic.path !== expected.path) {
    throw new Error(
      `Expected path ${expected.path}, received ${diagnostic.path}.`,
    );
  }

  if (expected.scope !== undefined && diagnostic.scope !== expected.scope) {
    throw new Error(
      `Expected scope ${expected.scope}, received ${diagnostic.scope}.`,
    );
  }
}

export async function createFixtureFromDirectory(
  sourceDirectory: string | URL,
): Promise<TestFixture> {
  const root = await mkFixtureRoot();
  const source =
    sourceDirectory instanceof URL
      ? fileURLToPath(sourceDirectory)
      : sourceDirectory;
  await cp(source, root, {
    recursive: true,
    filter: (sourcePath) =>
      !sourcePath.includes("node_modules") && !sourcePath.includes("dist"),
  });
  return fixtureFromRoot(root);
}

async function mkFixtureRoot(): Promise<string> {
  const root = join(tmpdir(), `qg-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

function fixtureFromRoot(root: string): TestFixture {
  return {
    root,
    fs: new NodeFileSystemProvider(root),
    changedProvider(changes) {
      return {
        async getChanged() {
          return changes;
        },
      };
    },
    path(relativePath) {
      return join(root, relativePath);
    },
    read(relativePath) {
      return readFile(join(root, relativePath), "utf8");
    },
    write(relativePath, content) {
      return writeFixtureFile(root, relativePath, content);
    },
    cleanup() {
      return rm(root, { recursive: true, force: true });
    },
  };
}

async function writeFixtureFile(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const fullPath = join(root, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}
