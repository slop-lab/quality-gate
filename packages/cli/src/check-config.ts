import type { CheckConfig } from "@slop-lab/qg-core";
import { requireObject, requireStrings } from "./config-values.js";

export function normalizeChecks(value: unknown, label: string): CheckConfig[] {
  if (Array.isArray(value)) {
    return value.map((check, index) => {
      const entry = `${label}[${index}]`;
      const object = requireObject(check, entry);
      return normalizeCheck(object, object.name, entry);
    });
  }
  return Object.entries(requireObject(value, label)).map(([name, check]) => {
    const entry = `${label}.${name}`;
    const object =
      typeof check === "string" ? { run: check } : requireObject(check, entry);
    if (object.name !== undefined)
      throw new Error(`${entry}.name is already defined by the check key`);
    return normalizeCheck(object, name, entry);
  });
}

function normalizeCheck(
  object: Record<string, unknown>,
  name: unknown,
  label: string,
): CheckConfig {
  if (typeof name !== "string" || !name.trim())
    throw new Error(`${label}.name must be a non-empty string`);
  if (object.message !== undefined && typeof object.message !== "string")
    throw new Error(`${label}.message must be a string`);
  if (
    object.timeoutMs !== undefined &&
    (typeof object.timeoutMs !== "number" ||
      !Number.isFinite(object.timeoutMs) ||
      object.timeoutMs <= 0)
  )
    throw new Error(`${label}.timeoutMs must be positive`);
  const cwd =
    object.cwd === undefined
      ? undefined
      : requireNonEmptyString(object.cwd, `${label}.cwd`);
  if (
    cwd &&
    (cwd.startsWith("/") || /[\\:]/.test(cwd) || cwd.split("/").includes(".."))
  )
    throw new Error(`${label}.cwd must be a project-relative path using '/'`);
  const common = {
    name,
    ...(cwd === undefined ? {} : { cwd }),
    ...(object.message === undefined ? {} : { message: object.message }),
    ...(object.timeoutMs === undefined ? {} : { timeoutMs: object.timeoutMs }),
  };
  const { type, run, command, args, files } = object;
  const unittestOptionNames = [
    "python",
    "startDirectory",
    "pattern",
    "topLevelDirectory",
  ] as const;
  const unittestOptions: Partial<
    Record<(typeof unittestOptionNames)[number], string>
  > = {};
  for (const option of unittestOptionNames) {
    if (object[option] === undefined) continue;
    if (type !== "unittest")
      throw new Error(`${label}.${option} is only supported for unittest`);
    unittestOptions[option] = requireNonEmptyString(
      object[option],
      `${label}.${option}`,
    );
  }
  if (type !== "node-test" && files !== undefined)
    throw new Error(`${label}.files is only supported for node-test`);
  if (
    (type === "node-test" || type === "unittest") &&
    (run !== undefined || command !== undefined || args !== undefined)
  )
    throw new Error(`${label}: ${type} does not accept run, command, or args`);
  if (type === "node-test") {
    const patterns = requireStrings(files, `${label}.files`);
    if (!patterns.length || patterns.some((file) => !file.trim()))
      throw new Error(
        `${label}.files must contain non-empty test paths or globs`,
      );
    return { ...common, type, files: patterns };
  }
  if (type === "unittest") return { ...common, type, ...unittestOptions };
  if (type === "jest" || type === "cargo" || type === "vitest") {
    if (run !== undefined || command !== undefined)
      throw new Error(`${label}: ${type} does not accept run or command`);
    return {
      ...common,
      type,
      ...(args === undefined
        ? {}
        : { args: requireStrings(args, `${label}.args`) }),
    };
  }
  if (type !== undefined && type !== "command")
    throw new Error(
      `${label}.type must be command, node-test, unittest, jest, vitest, or cargo`,
    );
  const commandCheck = { ...common, ...(type && ({ type } as const)) };
  if (run !== undefined) {
    if (command !== undefined || args !== undefined)
      throw new Error(`${label}.run cannot be combined with command or args`);
    const [executable, ...commandArgs] = splitCommand(run, `${label}.run`);
    return { ...commandCheck, command: executable, args: commandArgs };
  }
  return {
    ...commandCheck,
    command: requireNonEmptyString(command, `${label}.command`),
    ...(args === undefined
      ? {}
      : { args: requireStrings(args, `${label}.args`) }),
  };
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error(`${label} must be a non-empty string without null bytes`);
  return value;
}

function splitCommand(value: unknown, label: string): [string, ...string[]] {
  const line = requireNonEmptyString(value, label);
  const words: string[] = [];
  let word: string | undefined;
  for (const [token, doubleQuoted, singleQuoted] of line.matchAll(
    /"([^"]*)"|'([^']*)'|[^\s'"]+|\s+|['"]/g,
  )) {
    if (token === '"' || token === "'")
      throw new Error(`${label} contains an unclosed quote`);
    if (/^\s/.test(token)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else {
      word = (word ?? "") + (doubleQuoted ?? singleQuoted ?? token);
    }
  }
  if (word !== undefined) words.push(word);
  const [command, ...args] = words;
  return [requireNonEmptyString(command, label), ...args];
}
