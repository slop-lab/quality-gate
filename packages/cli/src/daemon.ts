import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { join, resolve } from "node:path";
import type { RunResult } from "@quality-gate/core";

export interface DaemonResponse {
  code: number;
  result?: RunResult;
  error?: string;
  generation?: number;
}

interface Request {
  method: "check" | "ping" | "stop";
  args?: string[];
}

export function daemonDirectory(root: string): string {
  return join(root, ".local", "cache", "quality-gate");
}

export function daemonSocket(root: string): string {
  if (process.platform === "win32") {
    const identity = createHash("sha256")
      .update(resolve(root).toLowerCase())
      .digest("hex");
    return `\\\\.\\pipe\\quality-gate-${identity}`;
  }
  return join(daemonDirectory(root), "daemon.sock");
}

export async function startDaemon(
  root: string,
  check: (args: string[]) => Promise<DaemonResponse>,
): Promise<void> {
  const socket = daemonSocket(root);
  await mkdir(daemonDirectory(root), { recursive: true });
  if (process.platform !== "win32") await rm(socket, { force: true });
  let generation = 0;
  const watchers = await watchWorkspace(root, () => {
    generation += 1;
  });
  const server = createServer({ allowHalfOpen: true }, (connection) => {
    let input = "";
    let received = false;
    connection.setEncoding("utf8");
    connection.on("data", (chunk) => {
      input += chunk;
      const boundary = input.indexOf("\n");
      if (!received && boundary >= 0) {
        received = true;
        void respond(input.slice(0, boundary));
      }
    });
    async function respond(message: string): Promise<void> {
      try {
        const request = JSON.parse(message) as Request;
        if (request.method === "ping")
          connection.end(JSON.stringify({ code: 0, generation }));
        else if (request.method === "stop") {
          connection.end(JSON.stringify({ code: 0, generation }));
          server.close();
        } else {
          connection.end(
            JSON.stringify({
              ...(await check(request.args ?? [])),
              generation,
            }),
          );
        }
      } catch (error) {
        connection.end(
          JSON.stringify({
            code: 2,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  });
  const closed = new Promise<void>((resolve) => server.once("close", resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, resolve);
    });
    await closed;
  } finally {
    for (const watcher of watchers) watcher.close();
    // Named pipes are released by Windows when the server closes.
    if (process.platform !== "win32") await rm(socket, { force: true });
  }
}

async function watchWorkspace(
  root: string,
  changed: () => void,
): Promise<Array<ReturnType<typeof watch>>> {
  const watchers: Array<ReturnType<typeof watch>> = [];
  const pending = [root];
  const ignored = new Set([".git", ".local", "dist", "node_modules"]);
  while (pending.length > 0) {
    const directory = pending.shift();
    if (!directory) continue;
    try {
      watchers.push(watch(directory, changed));
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && !ignored.has(entry.name)) {
          pending.push(join(directory, entry.name));
        }
      }
    } catch {
      // A concurrent delete is harmless; Git index validation remains authoritative.
    }
  }
  try {
    watchers.push(watch(join(root, ".git", "index"), changed));
  } catch {
    // The workspace may not be a Git repository yet.
  }
  return watchers;
}

export async function requestDaemon(
  root: string,
  method: Request["method"],
  args?: string[],
): Promise<DaemonResponse | undefined> {
  return new Promise((resolve) => {
    const connection = createConnection(daemonSocket(root));
    let output = "";
    connection.setEncoding("utf8");
    connection.on("connect", () =>
      connection.write(`${JSON.stringify({ method, args })}\n`),
    );
    connection.on("data", (chunk) => {
      output += chunk;
    });
    connection.on("end", () => {
      try {
        resolve(JSON.parse(output) as DaemonResponse);
      } catch {
        resolve(undefined);
      }
    });
    connection.on("error", () => resolve(undefined));
  });
}
