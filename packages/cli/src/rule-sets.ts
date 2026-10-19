import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { QualityGateConfig, Rule } from "@slop-lab/qg-core";
import { recommendedRules } from "@slop-lab/qg-rules-recommended";

const optionalPresets = {
  js: { packageName: "@slop-lab/qg-rules-js", exportName: "jsRules" },
  test: { packageName: "@slop-lab/qg-rules-test", exportName: "testRules" },
};

export async function loadRules(
  root: string,
  config?: QualityGateConfig,
): Promise<Rule[]> {
  const rules = [...recommendedRules];
  const require = createRequire(resolve(root, "package.json"));
  for (const preset of new Set(config?.presets ?? [])) {
    const definition = optionalPresets[preset];
    let entry: string;
    try {
      entry = require.resolve(definition.packageName);
    } catch (error) {
      throw new Error(
        `Preset ${preset} requires ${definition.packageName} in the project. Install it with npm install --save-dev ${definition.packageName}.`,
        { cause: error },
      );
    }
    const loaded = await import(pathToFileURL(entry).href);
    const extra = loaded[definition.exportName] as Rule[];
    if (
      !Array.isArray(extra) ||
      extra.some(
        (rule) =>
          typeof rule?.check !== "function" ||
          typeof rule.metadata?.id !== "string",
      )
    )
      throw new Error(
        `${definition.packageName} must export ${definition.exportName} as a rule array.`,
      );
    rules.push(...extra);
  }
  const ids = new Set(rules.map((rule) => rule.metadata.id));
  for (const settings of [
    config?.rules,
    ...(config?.overrides?.map((override) => override.rules) ?? []),
  ]) {
    for (const [id, setting] of Object.entries(settings ?? {})) {
      const severity =
        typeof setting === "string"
          ? setting
          : Array.isArray(setting)
            ? setting[0]
            : setting.severity;
      if (severity !== "off" && !ids.has(id))
        throw new Error(
          `Rule ${id} is not loaded. Select its preset in the root .qg.yaml (presets: [js] or [test]) and install the corresponding rule package.`,
        );
    }
  }
  return rules;
}
