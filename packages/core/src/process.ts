import { execFile } from "node:child_process";
import type {
  ProcessExecOptions,
  ProcessProvider,
  ProcessResult,
} from "./types.js";

export class NodeProcessProvider implements ProcessProvider {
  async exec(options: ProcessExecOptions): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        options.command,
        options.args,
        {
          cwd: options.cwd,
          env: options.env ? { ...process.env, ...options.env } : process.env,
          timeout: options.timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error && (typeof error.code !== "number" || error.killed)) {
            reject(error);
            return;
          }
          const exitCode =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "number"
              ? error.code
              : error
                ? 1
                : 0;

          resolve({
            exitCode,
            stdout,
            stderr,
          });
        },
      );
      child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED")
          reject(error);
      });
      child.stdin?.end(options.input);
    });
  }
}
