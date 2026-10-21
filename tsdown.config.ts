import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "tsdown";

const packages = fileURLToPath(new URL("./packages/", import.meta.url));

// tsdown owns the generated export maps, including tool subpaths and the shared test reporter.
export default defineConfig(
  readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((directory) => {
      const cwd = join(packages, directory.name);
      const pkg = JSON.parse(
        readFileSync(join(cwd, "package.json"), "utf8"),
      ) as { name: string };
      return {
        name: pkg.name,
        cwd,
        entry:
          pkg.name === "@slop-lab/qg-checks"
            ? ["src/index.ts", "src/node-test-reporter.ts"]
            : pkg.name === "@slop-lab/qg-rules-tools"
              ? [
                  "src/index.ts",
                  "src/biome.ts",
                  "src/prettier.ts",
                  "src/eslint.ts",
                ]
              : ["src/index.ts"],
        format: "esm",
        platform: "node",
        target: "node24",
        dts: true,
        // tsc also emits the test files into dist for node --test.
        clean: false,
        exports: { legacy: true, bin: false },
        deps: { neverBundle: true },
      } satisfies UserConfig;
    }),
);
