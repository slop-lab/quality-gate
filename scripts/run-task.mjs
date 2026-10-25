// @ts-check
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanWorkspaceBuildOutputs } from "./workspace-packages.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
/** @type {Record<string, string[][]>} */
const tasks = {
  build: [
    ["pnpm", "exec", "tsc", "-b", "--force"],
    ["pnpm", "exec", "tsdown"],
  ],
  install: [["pnpm", "install", "--frozen-lockfile"]],
  format: [["pnpm", "exec", "biome", "format", "--write", "."]],
  pack: [
    [
      "npm",
      "pack",
      "--workspaces",
      "--dry-run",
      "--include-workspace-root=false",
    ],
  ],
};
const task = process.argv[2] ?? "build";
if (!Object.hasOwn(tasks, task) || process.argv.length > 3) {
  console.error("Usage: node scripts/run-task.mjs <build|install|format|pack>");
  process.exit(1);
}
if (task === "build") {
  cleanWorkspaceBuildOutputs(
    fileURLToPath(new URL("../packages/", import.meta.url)),
  );
}
for (const [executable, ...args] of tasks[task]) {
  // All commands and arguments above are fixed, including the Windows shell form.
  const command = [executable, ...args].join(" ");
  const windows = process.platform === "win32";
  const result = spawnSync(
    windows ? (process.env.ComSpec ?? "cmd.exe") : executable,
    windows ? ["/d", "/s", "/c", command] : args,
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status === 0 && !result.error) continue;
  process.stderr.write(`FAIL: ${command}\n`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  if (result.signal) process.stderr.write(`Terminated by ${result.signal}\n`);
  process.exit(result.status ?? 1);
}

if (task === "format") console.log("OK");
if (task === "pack") console.log("PASS");
