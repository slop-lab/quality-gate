import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DirectoryEntry, FileSystemProvider } from "./types.js";

export class NodeFileSystemProvider implements FileSystemProvider {
  constructor(private readonly root: string) {}

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async isFile(path: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(path))).isFile();
    } catch {
      return false;
    }
  }

  async isDirectory(path: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(path))).isDirectory();
    } catch {
      return false;
    }
  }

  async readDirectory(path: string): Promise<DirectoryEntry[]> {
    const entries = await readdir(this.resolve(path), { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: path === "." ? entry.name : `${path}/${entry.name}`,
      type: entry.isFile()
        ? "file"
        : entry.isDirectory()
          ? "directory"
          : entry.isSymbolicLink()
            ? "symlink"
            : "other",
    }));
  }

  async readFile(path: string): Promise<string> {
    return readFile(this.resolve(path), "utf8");
  }

  private resolve(path: string): string {
    return join(this.root, path);
  }
}
