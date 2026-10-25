// @ts-check
import { existsSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

/** @param {string} directory */
export function findWorkspacePackages(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(directory, entry.name, "package.json")),
    )
    .map((entry) => join(directory, entry.name));
}

/** Remove only generated dist directories, including leftovers from renamed packages.
 * @param {string} directory
 */
export function cleanWorkspaceBuildOutputs(directory) {
  const root = realpathSync(directory);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const output = join(root, entry.name, "dist");
    const path = relative(root, output);
    if (
      isAbsolute(path) ||
      path === ".." ||
      path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
    )
      throw new Error(
        `Build output is outside the packages directory: ${output}`,
      );
    rmSync(output, { recursive: true, force: true });
  }
}
