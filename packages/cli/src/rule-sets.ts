import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createRulesFromProvider,
  isRuleMetadata,
  isRuleProvider,
  type QualityGateConfig,
  type Rule,
} from "@slop-lab/qg-core";
import { recommendedRules } from "@slop-lab/qg-rules-recommended";

const optionalPresets = {
  "js-directives": {
    packageName: "@slop-lab/qg-rules-js-directives",
    exportName: "jsDirectiveRules",
  },
  "js-test-fixtures": {
    packageName: "@slop-lab/qg-rules-js-test-fixtures",
    exportName: "jsTestFixtureRules",
  },
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
  for (const specifier of new Set(config?.ruleModules ?? [])) {
    let loaded: Record<string, unknown>;
    try {
      const entry =
        specifier.startsWith(".") || isAbsolute(specifier)
          ? resolve(root, specifier)
          : require.resolve(specifier);
      loaded = await import(pathToFileURL(entry).href);
    } catch (error) {
      throw new Error(
        `Cannot load rule module ${JSON.stringify(specifier)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const extra = loaded.rules ?? loaded.ruleProvider ?? loaded.default;
    if (isRuleProvider(extra)) {
      try {
        rules.push(...(await createRulesFromProvider(extra)));
      } catch (error) {
        throw new Error(
          `Invalid rule provider in ${JSON.stringify(specifier)}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    } else if (Array.isArray(extra) && extra.every(isRule)) {
      rules.push(...extra);
    } else {
      throw new Error(
        `Rule module ${JSON.stringify(specifier)} must export a rules array (named rules or default) with valid rule metadata and check functions, or a ruleProvider implementing getRules() and execute().`,
      );
    }
  }
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.metadata.id))
      throw new Error(`Duplicate rule ID: ${rule.metadata.id}`);
    ids.add(rule.metadata.id);
  }
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
          `Rule ${id} is not loaded. Select its preset in the root .qg.yaml (presets: [js-directives] or [js-test-fixtures]) and install the corresponding rule package, or add its module to ruleModules.`,
        );
    }
  }
  return rules;
}

function isRule(value: unknown): value is Rule {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Rule).check === "function" &&
    isRuleMetadata((value as Rule).metadata)
  );
}
