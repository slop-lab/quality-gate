import { cacheKey } from "./cache.js";

/** Stable identity used to invalidate cached values when plugins change. */
export interface VersionedPlugin {
  id: string;
  version: string;
  /** Configuration or implementation fingerprint beyond the published version. */
  cacheKey?: string;
}

/** Validate a plugin set and return an order-sensitive cache fingerprint. */
export function pluginFingerprint(plugins: readonly VersionedPlugin[]): string {
  const ids = new Set<string>();
  const values: string[] = ["qg-plugin-set-v1"];
  for (const plugin of plugins) {
    if (!plugin.id.trim()) throw new Error("Plugin id must not be empty.");
    if (!plugin.version.trim())
      throw new Error(`Plugin ${plugin.id} version must not be empty.`);
    if (ids.has(plugin.id))
      throw new Error(`Duplicate plugin ID: ${plugin.id}`);
    ids.add(plugin.id);
    values.push(plugin.id, plugin.version, plugin.cacheKey ?? "");
  }
  return cacheKey(...values);
}
