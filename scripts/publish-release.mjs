// @ts-check
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const flag = process.argv[2];
if (process.argv.length > 3 || (flag !== undefined && flag !== "--dry-run")) {
  console.error("Usage: node scripts/publish-release.mjs [--dry-run]");
  process.exit(1);
}

const root = fileURLToPath(new URL("../", import.meta.url));
const workspaces = [
  "@slop-lab/qg-core",
  "@slop-lab/qg-rules-git",
  "@slop-lab/qg-rules-files",
  "@slop-lab/qg-rules-recommended",
  "@slop-lab/qg-check-runner",
  "@slop-lab/qg-check-node-test",
  "@slop-lab/qg-check-unittest",
  "@slop-lab/qg-check-jest",
  "@slop-lab/qg-check-vitest",
  "@slop-lab/qg-check-cargo",
  "@slop-lab/qg",
];

for (const workspace of workspaces) {
  const args = [
    "publish",
    "--workspace",
    workspace,
    "--access",
    "public",
    "--registry=https://registry.npmjs.org/",
  ];
  if (flag === "--dry-run") args.push(flag);

  // The Windows command line contains only fixed arguments.
  const windows = process.platform === "win32";
  const result = spawnSync(
    windows ? (process.env.ComSpec ?? "cmd.exe") : "npm",
    windows ? ["/d", "/s", "/c", ["npm", ...args].join(" ")] : args,
    { cwd: root, stdio: "inherit" },
  );
  if (result.status === 0) continue;

  console.error(`Publish failed for ${workspace}.`);
  if (result.error) console.error(result.error.message);
  if (result.signal) console.error(`Terminated by ${result.signal}.`);
  process.exit(result.status ?? 1);
}
