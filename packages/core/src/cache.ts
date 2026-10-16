import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RuleCache, RuleCacheStore } from "./types.js";

export class NoopRuleCacheStore implements RuleCacheStore {
  forRule(): RuleCache {
    return noopCache;
  }
  async clearRule(): Promise<void> {}
}

const noopCache: RuleCache = {
  async get() {
    return undefined;
  },
  async set() {},
  async delete() {},
  async clear() {},
};

export class JsonFileRuleCacheStore implements RuleCacheStore {
  constructor(private readonly directory: string) {}
  forRule(ruleId: string): RuleCache {
    return new JsonFileRuleCache(
      join(this.directory, `${safeName(ruleId)}.json`),
    );
  }
  async clearRule(ruleId: string): Promise<void> {
    const path = join(this.directory, `${safeName(ruleId)}.json`);
    await withCacheLock(path, () => rm(path, { force: true }));
  }
}

class JsonFileRuleCache implements RuleCache {
  private values: Record<string, unknown> | undefined;
  constructor(private readonly path: string) {}
  async get<T>(key: string): Promise<T | undefined> {
    return withCacheLock(this.path, async () => {
      await this.load();
      return this.values?.[key] as T | undefined;
    });
  }
  async set<T>(key: string, value: T): Promise<void> {
    await withCacheLock(this.path, async () => {
      this.values = undefined;
      await this.load();
      this.values ??= {};
      this.values[key] = value;
      await this.save();
    });
  }
  async delete(key: string): Promise<void> {
    await withCacheLock(this.path, async () => {
      this.values = undefined;
      await this.load();
      if (this.values) delete this.values[key];
      await this.save();
    });
  }
  async clear(): Promise<void> {
    await withCacheLock(this.path, async () => {
      this.values = {};
      await rm(this.path, { force: true });
    });
  }
  private async load(): Promise<void> {
    if (this.values) return;
    try {
      this.values = JSON.parse(await readFile(this.path, "utf8")) as Record<
        string,
        unknown
      >;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        this.values = {};
      else throw error;
    }
  }
  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(this.values));
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

// Only retain locks for active operations; serialize writes from parallel daemon checks.
const pendingOperations = new Map<string, Promise<void>>();

async function withCacheLock<T>(
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = pendingOperations.get(path) ?? Promise.resolve();
  const operation = previous.then(action);
  const settled = operation.then(
    () => {},
    () => {},
  );
  pendingOperations.set(path, settled);
  try {
    return await operation;
  } finally {
    if (pendingOperations.get(path) === settled) pendingOperations.delete(path);
  }
}

export function cacheKey(...values: Array<string | Uint8Array>): string {
  const hash = createHash("sha256");
  for (const value of values) hash.update(value);
  return hash.digest("hex");
}

function safeName(ruleId: string): string {
  return ruleId.replaceAll("/", "__").replace(/[^\w.-]/g, "_");
}
