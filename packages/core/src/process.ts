import { execFile } from "node:child_process";
import type {
  ProcessExecOptions,
  ProcessProvider,
  ProcessResult,
} from "./types.js";

export class NodeProcessProvider implements ProcessProvider {
  async exec(options: ProcessExecOptions): Promise<ProcessResult> {
    return new Promise((resolve) => {
      execFile(
        options.command,
        options.args,
        { cwd: options.cwd, env: options.env },
        (error, stdout, stderr) => {
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
    });
  }
}
