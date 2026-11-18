import { dirname, resolve } from "node:path";
import type {
  CheckConfig,
  ProcessExecOptions,
  ProcessProvider,
} from "@slop-lab/qg-core";

type CargoCheck = Extract<CheckConfig, { type: "cargo" }>;

export function createCommand(
  _root: string,
  check: CargoCheck,
): Pick<ProcessExecOptions, "command" | "args"> {
  return { command: "cargo", args: ["test", ...(check.args ?? [])] };
}

export async function getArtifactDirectories(
  cwd: string,
  check: CargoCheck,
  provider: ProcessProvider,
): Promise<string[]> {
  const args = ["metadata", "--format-version", "1", "--no-deps", "--offline"];
  let targetDirectory: string | undefined;
  let manifest: string | undefined;
  const testArgs = check.args ?? [];
  for (let index = 0; index < testArgs.length; index += 1) {
    const arg = testArgs[index];
    if (arg === "--") break;
    const option = /^(--manifest-path|--config|--target-dir)(?:=(.*))?$/.exec(
      arg,
    );
    if (!option) continue;
    const value = option[2] ?? testArgs[++index];
    if (!value) break;
    if (option[1] === "--target-dir") targetDirectory = resolve(cwd, value);
    else {
      args.push(option[1], value);
      if (option[1] === "--manifest-path") manifest = value;
    }
  }
  try {
    const result = await provider.exec({
      command: "cargo",
      args,
      cwd,
      ...(targetDirectory && { env: { CARGO_TARGET_DIR: targetDirectory } }),
      timeoutMs: Math.min(check.timeoutMs ?? 10_000, 10_000),
    });
    if (result.exitCode === 0) {
      const metadata = JSON.parse(result.stdout) as {
        target_directory?: unknown;
        build_directory?: unknown;
      };
      return [
        targetDirectory ?? metadata.target_directory,
        metadata.build_directory,
      ].filter((path): path is string => typeof path === "string" && !!path);
    }
  } catch {
    // The actual test check reports Cargo launch and manifest errors.
  }
  return [
    targetDirectory ??
      resolve(cwd, dirname(manifest ?? "Cargo.toml"), "target"),
  ];
}
