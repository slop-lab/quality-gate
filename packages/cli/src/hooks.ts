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
  const content = `${header}set -eu\ncd "$(git rev-parse --show-toplevel)"\nexec node ${shellQuote(executable)} pre-commit\n`;
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
