import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "tsdown";
import { findWorkspacePackages } from "./scripts/workspace-packages.mjs";

const packages = fileURLToPath(new URL("./packages/", import.meta.url));

// tsdown owns the generated export maps, including the shared test reporter.
export default defineConfig(
  findWorkspacePackages(packages).map((cwd) => {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
      name: string;
    };
    return {
      name: pkg.name,
      cwd,
      entry:
        pkg.name === "@slop-lab/qg-check-runner"
          ? ["src/index.ts", "src/node-test-reporter.ts"]
          : ["src/index.ts"],
      format: "esm",
      platform: "node",
      target: "node24",
      dts: true,
      // run-task cleans dist before tsc; retain its test files for node --test.
      clean: false,
      exports: { legacy: true, bin: false },
      deps: { neverBundle: true },
    } satisfies UserConfig;
  }),
);
