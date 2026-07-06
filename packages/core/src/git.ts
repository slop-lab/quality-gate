import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ChangedProvider,
  ChangedProviderOptions,
  ChangeEntry,
  ChangeStatus,
} from "./types.js";

const execFileAsync = promisify(execFile);

export class GitChangedProvider implements ChangedProvider {
  async getChanged(options: ChangedProviderOptions): Promise<ChangeEntry[]> {
    const args = buildDiffArgs(options);
    const { stdout } = await execFileAsync("git", args, { cwd: options.root });
    return parseNameStatus(stdout);
  }
}

export function buildDiffArgs(options: ChangedProviderOptions): string[] {
  if (options.staged) {
    return ["diff", "--cached", "--name-status", "--find-renames"];
  }

  if (options.workingTree) {
    return ["diff", "--name-status", "--find-renames"];
  }

  const base = options.base ?? "HEAD";
  const head = options.head ?? "HEAD";
  return ["diff", "--name-status", "--find-renames", `${base}...${head}`];
}

export function parseNameStatus(output: string): ChangeEntry[] {
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
