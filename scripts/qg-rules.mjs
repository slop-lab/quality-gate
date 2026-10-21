// @ts-check
import { createFilePathRule, createRuleProvider } from "@slop-lab/qg-core";

const publicPackage = createFilePathRule({
  id: "project/public-package",
  name: "Public package contract",
  description:
    "Keeps package names, release metadata, and npm dependencies consistent.",
  requires: ["fileContent"],
  recheckOnChanges: ["package.json"],
  defaultOptions: {
    files: ["packages/*/package.json"],
    packagePrefix: "@slop-lab/qg",
  },
  async validate(path, context) {
    const manifest = JSON.parse(await context.fs.readFile(path));
    const root = JSON.parse(await context.fs.readFile("package.json"));
    const directory = path.split("/")[1];
    const expectedName =
      directory === "cli"
        ? context.options.packagePrefix
        : `${context.options.packagePrefix}-${directory}`;
    const issues = [];
    if (manifest.name !== expectedName)
      issues.push(`name must be ${expectedName}`);
    for (const field of ["version", "license"]) {
      if (manifest[field] !== root[field])
        issues.push(`${field} must match root package.json (${root[field]})`);
    }
    if (manifest.engines?.node !== root.engines?.node)
      issues.push("Node.js engine requirement must match root package.json");
    if (manifest.private || manifest.publishConfig?.access !== "public")
      issues.push("workspace packages must publish with public access");
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (typeof version !== "string") continue;
        if (version.startsWith("workspace:"))
          issues.push(`${field}.${name} must use an npm-publishable version`);
        if (
          name.startsWith(`${context.options.packagePrefix}-`) ||
          name === context.options.packagePrefix
        ) {
          if (version !== root.version)
            issues.push(
              `${field}.${name} must match release version ${root.version}`,
            );
        }
      }
    }
    return issues.length ? issues.join("; ") : undefined;
  },
});

export const ruleProvider = createRuleProvider([publicPackage]);
