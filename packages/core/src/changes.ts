import { cacheKey } from "./cache.js";
import { matchesAnyGlob } from "./config.js";
import { pluginFingerprint, type VersionedPlugin } from "./plugins.js";
import type { ChangeEntry, ScanMode } from "./types.js";

export interface RecheckAllFilesInput {
  mode: ScanMode;
  changes: ChangeEntry[];
}

export interface RecheckTriggerPlugin extends VersionedPlugin {
  shouldRecheck(input: RecheckAllFilesInput): boolean | Promise<boolean>;
}

export function createGlobRecheckTrigger(
  patterns: readonly string[],
  id = "qg/glob-recheck-trigger",
): RecheckTriggerPlugin {
  const normalized = [...patterns];
  return {
    id,
    version: "1",
    cacheKey: cacheKey(...normalized),
    shouldRecheck(input) {
      return input.changes.some((change) =>
        [change.path, change.oldPath].some(
          (path) => path !== undefined && matchesAnyGlob(path, normalized),
        ),
      );
    },
  };
}

/**
 * Return whether a rule should inspect all existing files instead of only
 * changed paths because a shared, glob-selected input changed.
 */
export async function shouldRecheckAllFiles(
  input: RecheckAllFilesInput,
  triggers: readonly RecheckTriggerPlugin[],
): Promise<boolean> {
  if (input.mode === "full") return true;
  pluginFingerprint(triggers);
  for (const trigger of triggers)
    if (await trigger.shouldRecheck(input)) return true;
  return false;
}
