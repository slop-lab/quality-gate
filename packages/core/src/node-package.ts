import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/** Resolve the named bin entry of a package installed in the project. */
export function resolveNodePackageBinary(
  root: string,
  packageName: string,
): string {
  const require = createRequire(resolve(root, "package.json"));
  let manifestPath: string;
  let manifest: string;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
    manifest = readFileSync(manifestPath, "utf8");
  } catch (error) {
    throw new Error(`Install ${packageName} in the project to run its tests.`, {
      cause: error,
    });
  }
  const { bin } = JSON.parse(manifest) as {
    bin?: string | Record<string, string>;
  };
  const entry = typeof bin === "string" ? bin : bin?.[packageName];
  if (!entry)
    throw new Error(
      `${packageName} does not declare a ${packageName} executable.`,
    );
  return resolve(dirname(manifestPath), entry);
}
