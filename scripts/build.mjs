// @ts-check
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const args of [["tsc", "-b"], ["tsdown"]]) {
  const command = `pnpm exec ${args.join(" ")}`;
  const windows = process.platform === "win32";
  const result = spawnSync(
    windows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
    windows ? ["/d", "/s", "/c", command] : ["exec", ...args],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status === 0 && !result.error) continue;
  process.stderr.write(`Build failed: ${command}\n`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  if (result.signal) process.stderr.write(`Terminated by ${result.signal}\n`);
  process.exit(result.status ?? 1);
}
