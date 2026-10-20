import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { execPath } from "node:process";
import { test } from "node:test";
import {
  createRuleProvider,
  createRulesFromProvider,
  type FileSystemProvider,
  type Rule,
  type RuleExecutionRequest,
  type RuleExecutionResult,
  type RuleExecutionServices,
  type RuleProvider,
  runQualityGate,
} from "./index.js";

const fs: FileSystemProvider = {
  exists: async (path) => path === "src/Bad.ts",
  isFile: async (path) => path === "src/Bad.ts",
  isDirectory: async (path) => path === "src" || path === ".",
  readDirectory: async () => [],
  readFile: async () => "staged contents",
  readFileBytes: async () => new TextEncoder().encode("staged contents"),
};

const metadata: Rule["metadata"] = {
  id: "test/provider",
  name: "Provider",
  description: "Provider contract",
  defaultSeverity: "error",
  supports: ["changed", "full"],
  scope: "file",
  requires: ["fileContent"],
  fixable: "none",
};

test("provider round trips existing rules and retains host services and per-path resolution", async () => {
  const rule: Rule = {
    metadata,
    async check(context) {
      assert.equal(context.root, "/project");
      assert.equal(context.mode, "changed");
      assert.deepEqual(context.changes, [
        { status: "modified", path: "src/Bad.ts" },
      ]);
      assert.equal(await context.fs.readFile("src/Bad.ts"), "staged contents");
      assert.equal(context.resolveConfig("src/Bad.ts").severity, "warning");
      await context.cache.set("key", "value");
      assert.equal(await context.cache.get("key"), undefined);
      assert.equal(typeof context.process.exec, "function");
      assert.equal(typeof context.discovery.matches, "function");
      assert.equal(context.artifacts.isGenerated("src/Bad.ts"), false);
      return [
        {
          ruleId: metadata.id,
          scope: "file",
          path: "src/Bad.ts",
          severity: "error",
          message: "Original message",
        },
      ];
    },
  };
  const rules = await createRulesFromProvider(createRuleProvider([rule]));
  const result = await runQualityGate({
    root: "/project",
    rules,
    fs,
    mode: "changed",
    changedProvider: {
      getChanged: async () => [{ status: "modified", path: "src/Bad.ts" }],
    },
    config: {
      overrides: [
        {
          files: ["src/**"],
          rules: {
            [metadata.id]: { severity: "warning", message: "Recovery message" },
          },
        },
      ],
    },
  });
  assert.equal(result.diagnostics[0]?.severity, "warning");
  assert.equal(result.diagnostics[0]?.message, "Recovery message");
});

test("typed provider implementations can delegate to a real subprocess with snapshot data", async () => {
  interface Options {
    expected: string;
  }
  const provider: RuleProvider<Options> = {
    getRules: () => [
      { ...metadata, defaultOptions: { expected: "working tree" } },
    ],
    async execute(
      request: RuleExecutionRequest<Options>,
      services: RuleExecutionServices<Options>,
    ): Promise<RuleExecutionResult> {
      const content = await services.fs.readFile("src/Bad.ts");
      const result = await services.process.exec({
        command: execPath,
        args: [
          "--input-type=module",
          "-e",
          `
let input = ''; for await (const chunk of process.stdin) input += chunk;
const { request, content } = JSON.parse(input);
console.log(JSON.stringify({ diagnostics: content === request.options.expected ? [] : [{
  ruleId: request.ruleId, severity: request.severity, scope: 'file', path: 'src/Bad.ts', message: content,
}] }));`,
        ],
        cwd: process.cwd(),
        input: JSON.stringify({ request, content }),
        timeoutMs: 5000,
      });
      if (result.exitCode) throw new Error(result.stderr);
      return JSON.parse(result.stdout) as RuleExecutionResult;
    },
  };
  const result = await runQualityGate({
    root: "/project",
    rules: await createRulesFromProvider(provider),
    fs,
    mode: "full",
  });
  assert.equal(result.diagnostics[0]?.message, "staged contents");
});

test("provider adapters reject malformed metadata, duplicate IDs, and malformed execution results", async () => {
  const provider: RuleProvider = {
    getRules: () => [metadata],
    execute: async () => ({ diagnostics: [] }),
  };
  for (const invalid of [null, {}, { getRules() {} }]) {
    await assert.rejects(
      createRulesFromProvider(invalid as never),
      /implement getRules/,
    );
  }
  for (const invalid of [
    null,
    [{}],
    [{ ...metadata, supports: ["invalid"] }],
    [{ ...metadata, defaultEnabled: "yes" }],
  ]) {
    await assert.rejects(
      createRulesFromProvider({
        ...provider,
        getRules: () => invalid as never,
      }),
      /valid rule metadata/,
    );
  }
  await assert.rejects(
    createRulesFromProvider({
      ...provider,
      getRules: () => [metadata, metadata],
    }),
    /Duplicate rule ID/,
  );
  assert.throws(
    () => createRuleProvider([{ metadata } as Rule, { metadata } as Rule]),
    /Duplicate rule ID/,
  );
  for (const invalid of [
    null,
    {},
    { diagnostics: [null] },
    {
      diagnostics: [
        { ruleId: "other", severity: "error", message: "bad", scope: "file" },
      ],
    },
  ]) {
    const rules = await createRulesFromProvider({
      ...provider,
      execute: async () => invalid as never,
    });
    await assert.rejects(
      runQualityGate({ root: "/project", rules, fs, mode: "full" }),
      /must return diagnostics/,
    );
  }
  const rules = await createRulesFromProvider({
    ...provider,
    execute: async () => {
      throw new Error("daemon unavailable");
    },
  });
  await assert.rejects(
    runQualityGate({ root: "/project", rules, fs, mode: "full" }),
    /daemon unavailable/,
  );
});

test("the same provider interface can execute through an independent HTTP daemon", async (t) => {
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    calls.push(request.url ?? "");
    if (request.url === "/rules") {
      response.end(JSON.stringify([metadata]));
      return;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    response.end(
      JSON.stringify({
        diagnostics: [
          {
            ruleId: input.ruleId,
            severity: input.severity,
            scope: "file",
            path: "src/Bad.ts",
            message: input.content,
          },
        ],
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const provider: RuleProvider = {
    async getRules() {
      const response = await fetch(`${base}/rules`);
      return (await response.json()) as Rule["metadata"][];
    },
    async execute(request, services) {
      const response = await fetch(`${base}/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...request,
          content: await services.fs.readFile("src/Bad.ts"),
        }),
      });
      return (await response.json()) as RuleExecutionResult;
    },
  };
  const result = await runQualityGate({
    root: "/project",
    rules: await createRulesFromProvider(provider),
    fs,
    mode: "full",
  });
  assert.equal(result.diagnostics[0]?.message, "staged contents");
  assert.deepEqual(calls, ["/rules", "/check"]);
});
