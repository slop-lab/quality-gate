import { posix } from "node:path";
import {
  createFilePathRule,
  type FilePathOptions,
  type Rule,
} from "@slop-lab/qg-core";

export interface AllowedFilePathOptions extends FilePathOptions {
  /** Regular expressions matched against the entire filename or root-relative path. */
  allowedPatterns?: string[];
}

function allowedRule(target: "name" | "path"): Rule<AllowedFilePathOptions> {
  const id = `files/allowed-${target}`;
  return createFilePathRule<AllowedFilePathOptions>({
    id,
    name: target === "name" ? "Allowed filename" : "Allowed file path",
    description: `Restricts file ${target === "name" ? "names" : "paths"} to configured regular expressions. Explicit opt-in required.`,
    defaultOptions: { allowedPatterns: [] },
    validate(path, context) {
      const patterns = stringList(
        context.options.allowedPatterns,
        [],
        `${id}.allowedPatterns`,
      );
      const value = target === "name" ? posix.basename(path) : path;
      const expressions = patterns.map((pattern) => {
        try {
          const expression = new RegExp(pattern);
          return new RegExp(`^(?:${expression.source})(?![\\s\\S])`);
        } catch {
          throw new Error(
            `${id}: invalid allowed pattern ${JSON.stringify(pattern)}.`,
          );
        }
      });
      if (expressions.some((expression) => expression.test(value)))
        return undefined;
      return `File ${target} ${JSON.stringify(value)} must match one of the allowed patterns: ${patterns.join(", ") || "(none configured)"}.`;
    },
  });
}

export const allowedFilenameRule = allowedRule("name");
export const allowedFilePathRule = allowedRule("path");

function stringList(
  value: unknown,
  fallback: string[],
  label: string,
): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new Error(`${label} must be an array of strings.`);
  return value;
}
