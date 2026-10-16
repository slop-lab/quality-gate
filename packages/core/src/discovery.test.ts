import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NearbyFileDiscovery } from "./discovery.js";
import { NodeFileSystemProvider } from "./fs.js";
import { runQualityGate } from "./runner.js";
import type { Rule } from "./types.js";

test("nearby discovery finds the nearest marker and combines positive and negative conditions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "packages/app/src"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []");
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "packages/app/package.json"), "{}");
  await writeFile(join(root, "packages/app/app.csproj"), "");
  const discovery = new NearbyFileDiscovery(new NodeFileSystemProvider(root));
  assert.deepEqual(
    await discovery.findNearest(["package.json"], "packages/app/src"),
    { directory: "packages/app", paths: ["packages/app/package.json"] },
  );
  assert.equal(
    await discovery.matches(
      { anyOf: ["*.csproj", "Cargo.toml"] },
      "packages/app",
    ),
    true,
  );
  assert.equal(
    await discovery.matches({ allOf: ["package.json"] }, "packages/app/src"),
    false,
  );
  assert.equal(
    await discovery.matches(
      {
        allOf: ["package.json", "pnpm-workspace.yaml"],
        noneOf: ["Cargo.toml"],
        search: "ancestors",
      },
      "packages/app/src",
    ),
    true,
  );
  assert.equal(
    await discovery.matches(
      { noneOf: ["pnpm-workspace.yaml"], search: "ancestors" },
      "packages/app/src",
    ),
    false,
  );
  assert.equal(
    await discovery.findNearest(["Cargo.toml"], "packages/app/src"),
    undefined,
  );
  assert.equal(await discovery.matches({ anyOf: [] }), false);
});

test("discovery caches listings only within one scan and treats directory names as non-files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "README.md"));
  const fs = new NodeFileSystemProvider(root);
  let reads = 0;
  const readDirectory = fs.readDirectory.bind(fs);
  fs.readDirectory = async (path) => {
    reads += 1;
    return readDirectory(path);
  };
  const first = new NearbyFileDiscovery(fs);
  assert.equal(await first.matches({ allOf: ["README.md"] }), false);
  await first.findNearest(["package.json"]);
  assert.equal(reads, 1);
  await writeFile(join(root, "package.json"), "{}");
  assert.equal(
    await new NearbyFileDiscovery(fs).matches({ allOf: ["package.json"] }),
    true,
  );
  assert.equal(reads, 2);
});

test("discovery rejects escaping paths and filename conditions containing path separators", async () => {
  const discovery = new NearbyFileDiscovery(new NodeFileSystemProvider("."));
  for (const directory of [
    "../outside",
    "/absolute",
    "C:/outside",
    "src\\outside",
  ])
    await assert.rejects(
      discovery.findNearest(["package.json"], directory),
      /project-relative/,
    );
  for (const pattern of ["../package.json", "src/package.json", "", ".."])
    await assert.rejects(
      discovery.matches({ anyOf: [pattern] }),
      /filename globs/,
    );
  await assert.rejects(
    discovery.matches(JSON.parse('{"anyof":["package.json"]}')),
    /Unknown file condition/,
  );
});

test("runner evaluates automatic presence gates before executing rules and refreshes every scan", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qg-discovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let checks = 0;
  const rule: Rule = {
    metadata: {
      id: "test/detected",
      name: "detected",
      description: "test",
      defaultSeverity: "error",
      supports: ["full"],
      scope: "repo",
      requires: ["directoryListings"],
      fixable: "none",
      when: { allOf: ["package.json"], noneOf: ["Cargo.toml"] },
    },
    async check(context) {
      checks += 1;
      assert.equal(
        await context.discovery.matches({ anyOf: ["package.json"] }),
        true,
      );
      return [];
    },
  };
  const run = () => runQualityGate({ root, mode: "full", rules: [rule] });
  await run();
  assert.equal(checks, 0);
  await writeFile(join(root, "package.json"), "{}");
  await run();
  assert.equal(checks, 1);
  await writeFile(join(root, "Cargo.toml"), "");
  await run();
  assert.equal(checks, 1);
  await rm(join(root, "Cargo.toml"));
  rule.metadata.defaultEnabled = false;
  await run();
  assert.equal(checks, 1);
});
