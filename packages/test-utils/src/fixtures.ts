import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ChangedProvider,
  type ChangeEntry,
  type Diagnostic,
  NodeFileSystemProvider,
  type QualityGateConfig,
  type Rule,
  type RunOptions,
  type RunResult,
  resolveRuleConfig,
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

export interface RunRuleOptions<TOptions = unknown>
  extends Omit<RunOptions, "root" | "rules" | "mode" | "config"> {
  fixture: TestFixture;
  rule: Rule<TOptions>;
  /** Defaults to full, or changed when staged/workingTree is selected. */
  mode?: ScanMode;
  /** Synthetic changes; omit with staged/workingTree to read real Git changes. */
  changes?: ChangeEntry[];
  config?: QualityGateConfig;
  /** Override root rule options; path overrides still take precedence. */
  options?: Partial<TOptions>;
  severity?: Diagnostic["severity"] | "off";
}

export type ExpectedDiagnostic = Partial<Omit<Diagnostic, "message">> & {
  message?: string | RegExp;
};

export async function createFixture(
  files: Record<string, string>,
): Promise<TestFixture> {
  const root = await mkFixtureRoot();

  try {
    for (const [path, content] of Object.entries(files)) {
      await writeFixtureFile(root, path, content);
    }
    return fixtureFromRoot(root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export function runRule<TOptions = unknown>({
  fixture,
  rule,
  changes,
  config,
  options,
  severity,
  ...runOptions
}: RunRuleOptions<TOptions>): Promise<RunResult> {
  if (changes !== undefined && runOptions.changedProvider !== undefined)
    throw new Error("Pass either changes or changedProvider, not both.");
  let resolvedConfig = config;
  if (options !== undefined || severity !== undefined) {
    const resolved = resolveRuleConfig(config, rule);
    const base: unknown = resolved.options;
    const next: unknown = options;
    const merged =
      isObject(base) && isObject(next) ? { ...base, ...next } : (next ?? base);
    resolvedConfig = {
      ...config,
      rules: {
        ...config?.rules,
        [rule.metadata.id]: {
          severity: severity ?? (resolved.enabled ? resolved.severity : "off"),
          options: merged,
          ...(resolved.message === undefined
            ? {}
            : { message: resolved.message }),
        },
      },
    };
  }
  const realChanges =
    runOptions.staged ||
    runOptions.workingTree ||
    runOptions.base !== undefined ||
    runOptions.head !== undefined;
  return runQualityGate({
    ...runOptions,
    root: fixture.root,
    mode: runOptions.mode ?? (realChanges ? "changed" : "full"),
    rules: [rule],
    config: resolvedConfig,
    changedProvider:
      runOptions.changedProvider ??
      (changes !== undefined || !realChanges
        ? fixture.changedProvider(changes ?? [])
        : undefined),
    fs: runOptions.fs ?? (runOptions.staged ? undefined : fixture.fs),
  });
}

export function assertDiagnostic(
  diagnostic: Diagnostic | undefined,
  expected: ExpectedDiagnostic,
): asserts diagnostic is Diagnostic {
  if (!diagnostic) {
    throw new Error("Expected diagnostic, but received undefined.");
  }
  for (const [key, value] of Object.entries(expected)) {
    if (value === undefined) continue;
    if (key === "message" && value instanceof RegExp) {
      // Repeated assertions must not mutate a caller's stateful /g or /y regex.
      assert.match(diagnostic.message, new RegExp(value.source, value.flags));
    } else {
      assert.deepStrictEqual(
        diagnostic[key as keyof Diagnostic],
        value,
        `Diagnostic ${key} mismatch`,
      );
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createFixtureFromDirectory(
  sourceDirectory: string | URL,
): Promise<TestFixture> {
  const source = resolve(
    sourceDirectory instanceof URL
      ? fileURLToPath(sourceDirectory)
      : sourceDirectory,
  );
  const root = await mkFixtureRoot();
  try {
    await cp(source, root, {
      recursive: true,
      filter: (sourcePath) =>
        !relative(source, sourcePath)
          .split(sep)
          .some((part) => part === "node_modules" || part === "dist"),
    });
    return fixtureFromRoot(root);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
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
      return fixturePath(root, relativePath);
    },
    read(relativePath) {
      return readFile(fixturePath(root, relativePath), "utf8");
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
  const fullPath = fixturePath(root, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

function fixturePath(root: string, path: string): string {
  const fullPath = resolve(root, path);
  const fromRoot = relative(root, fullPath);
  if (
    isAbsolute(path) ||
    /[\\:\0]/.test(path) ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`)
  )
    throw new Error(
      `Fixture path must stay inside the fixture root and use '/': ${path}`,
    );
  return fullPath;
}
