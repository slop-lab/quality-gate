import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const header = "#!/bin/sh\n# Installed by qg hooks install.\n";

export async function installHooks(
  directory: string,
  cliPath: string,
  force = false,
): Promise<{ path: string; backup?: string }> {
  const { hooks, path, content } = await hookLocation(directory, cliPath);
  let previous: string | undefined;
  try {
    const stat = await lstat(path);
    if (!stat.isFile())
      throw new Error(`Cannot replace non-file hook: ${path}`);
    previous = await readFile(path, "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  let backup: string | undefined;
  if (
    previous !== undefined &&
    previous !== content &&
    !previous.startsWith(header)
  ) {
    if (!force)
      throw new Error(
        `A pre-commit hook already exists at ${path}. Move its checks into .qg.yaml, then run qg hooks install --force to back it up and replace it.`,
      );
    backup = `${path}.qg-backup-${Date.now()}`;
    await copyFile(path, backup, constants.COPYFILE_EXCL);
  }
  await mkdir(hooks, { recursive: true });
  if (previous !== content) await writeFile(path, content, { mode: 0o755 });
  await chmod(path, 0o755);
  return { path, ...(backup ? { backup } : {}) };
}

async function hookLocation(directory: string, cliPath: string) {
  const git = async (...args: string[]) =>
    (await exec("git", args, { cwd: directory })).stdout.trim();
  const root = await git("rev-parse", "--show-toplevel");
  const hooks = await git(
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "hooks",
  );
  const path = join(hooks, "pre-commit");
  // Prefer the stable project dependency path over pnpm's versioned store path.
  const localCli = join(
    root,
    "node_modules",
    "@slop-lab",
    "qg",
    "dist",
    "index.mjs",
  );
  let entry = resolve(cliPath);
  try {
    await readFile(localCli);
    entry = localCli;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const relativeEntry = relative(root, entry).replaceAll("\\", "/");
  const executable =
    relativeEntry.startsWith("../") || isAbsolute(relativeEntry)
      ? entry.replaceAll("\\", "/")
      : `./${relativeEntry}`;
  const content = `${header}set -eu\ncd "$(git rev-parse --show-toplevel)"\nexec node ${shellQuote(executable)} run-hook pre-commit\n`;
  return { hooks, path, content, entry };
}

/** Return an actionable setup issue, outside the rule diagnostic pipeline. */
export async function inspectPreCommitHook(
  directory: string,
  cliPath: string,
): Promise<string | undefined> {
  try {
    const { path, content, entry } = await hookLocation(directory, cliPath);
    let installed: string;
    let executable: boolean;
    try {
      const info = await lstat(path);
      executable = process.platform === "win32" || Boolean(info.mode & 0o111);
      installed = await readFile(path, "utf8");
    } catch (error) {
      if (isMissing(error))
        return `QG pre-commit hook is not installed at ${path}.`;
      throw error;
    }
    if (!executable) return `Pre-commit hook is not executable: ${path}.`;
    if (installed !== content)
      return `Pre-commit hook does not match the current QG hook at ${path}.`;
    try {
      await readFile(entry);
    } catch (error) {
      if (isMissing(error))
        return `QG hook CLI entry point is missing: ${entry}.`;
      throw error;
    }
    return undefined;
  } catch (error) {
    // Outside a Git worktree, there is no local pre-commit hook to verify.
    if (
      error instanceof Error &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      /not a git repository|must be run in a work tree/.test(error.stderr)
    )
      return undefined;
    return `Cannot verify the QG pre-commit hook: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
