import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ChangedProvider,
  ChangedProviderOptions,
  ChangeEntry,
  ChangeStatus,
  DirectoryEntry,
  FileSystemProvider,
} from "./types.js";

const execFileAsync = promisify(execFile);

export class GitIndexFileSystemProvider implements FileSystemProvider {
  constructor(private readonly root: string) {}
  async exists(path: string): Promise<boolean> {
    return (await this.isFile(path)) || this.isDirectory(path);
  }
  async isFile(path: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["cat-file", "-e", `:${path}`], {
        cwd: this.root,
      });
      return true;
    } catch {
      return false;
    }
  }
  async isDirectory(path: string): Promise<boolean> {
    return (await this.list(path)).length > 0;
  }
  async readDirectory(path: string): Promise<DirectoryEntry[]> {
    const prefix = path === "." ? "" : `${path}/`;
    const entries = new Map<string, DirectoryEntry>();
    for (const file of await this.list(path)) {
      const remainder = file.slice(prefix.length);
      const name = remainder.split("/")[0];
      if (!name) continue;
      const entryPath = prefix + name;
      entries.set(name, {
        name,
        path: entryPath,
        type: remainder.includes("/") ? "directory" : "file",
      });
    }
    return [...entries.values()];
  }
  async readFile(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readFileBytes(path));
  }
  async readFileBytes(path: string): Promise<Uint8Array> {
    const { stdout } = await execFileAsync("git", ["show", `:${path}`], {
      cwd: this.root,
      encoding: "buffer",
      maxBuffer: 50 * 1024 * 1024,
    });
    return new Uint8Array(stdout);
  }
  private async list(path: string): Promise<string[]> {
    const args = ["ls-files", "-z"];
    if (path !== ".") args.push("--", path);
    const { stdout } = await execFileAsync("git", args, { cwd: this.root });
    return stdout.split("\0").filter(Boolean);
  }
}

export class GitChangedProvider implements ChangedProvider {
  async getChanged(options: ChangedProviderOptions): Promise<ChangeEntry[]> {
    const args = buildDiffArgs(options);
    const { stdout } = await execFileAsync("git", args, { cwd: options.root });
    return parseNameStatus(stdout);
  }
}

export function buildDiffArgs(options: ChangedProviderOptions): string[] {
  if (options.staged) {
    return ["diff", "--cached", "--name-status", "-z", "--find-renames"];
  }

  if (options.workingTree) {
    return ["diff", "--name-status", "-z", "--find-renames"];
  }

  const base = options.base ?? "HEAD";
  const head = options.head ?? "HEAD";
  return ["diff", "--name-status", "-z", "--find-renames", `${base}...${head}`];
}

export function parseNameStatus(output: string): ChangeEntry[] {
  if (output.includes("\0")) {
    const fields = output.split("\0");
    const changes: ChangeEntry[] = [];
    for (let index = 0; index < fields.length - 1; ) {
      const rawStatus = fields[index++];
      const path = fields[index++];
      const status = mapStatus(rawStatus[0] ?? "");
      if (status === "renamed" || status === "copied") {
        const destination = fields[index++];
        changes.push({
          status,
          path: destination,
          oldPath: path,
          similarity: Number(rawStatus.slice(1)),
        });
      } else changes.push({ status, path });
    }
    return changes;
  }
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [rawStatus, firstPath, secondPath] = line.split("\t");
      const statusCode = rawStatus[0] ?? "";
      const similarity =
        rawStatus.length > 1 ? Number(rawStatus.slice(1)) : undefined;
      const status = mapStatus(statusCode);

      if ((status === "renamed" || status === "copied") && secondPath) {
        return {
          status,
          path: secondPath,
          oldPath: firstPath,
          similarity: Number.isFinite(similarity) ? similarity : undefined,
        };
      }

      return {
        status,
        path: firstPath,
      };
    });
}

function mapStatus(status: string): ChangeStatus {
  switch (status) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type_changed";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}
