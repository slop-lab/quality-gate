import type { Diagnostic, Rule } from "@slop-lab/qg-core";
import {
  type DocumentFileOptions,
  documentPaths,
  isDocumentPath,
} from "./document-files.js";

export interface AllowedMarkdownCharactersOptions extends DocumentFileOptions {
  allowedLanguages?: string[];
  allowedScripts?: string[];
  allowedCharacters?: string[];
}

const compositeScripts: Record<string, string[]> = {
  Kore: ["Hang"],
  Jpan: ["Hira", "Kana", "Hani"],
  Hans: ["Hani"],
  Hant: ["Hani", "Bopo"],
  Hanb: ["Hani", "Bopo"],
  Hrkt: ["Hira", "Kana"],
};

export const allowedMarkdownCharactersRule: Rule<AllowedMarkdownCharactersOptions> =
  {
    metadata: {
      id: "markdown/allowed-characters",
      name: "Allowed Markdown characters",
      description:
        "Allows searchable ASCII Markdown with explicit language and character additions.",
      defaultSeverity: "error",
      supports: ["changed", "full"],
      scope: "file",
      requires: ["fileContent"],
      fixable: "suggestion",
      defaultOptions: {},
      ignoreGeneratedArtifacts: true,
    },
    async check(context) {
      const diagnostics: Diagnostic[] = [];
      const policies = new Map<string, (character: string) => boolean>();
      function policy(options: AllowedMarkdownCharactersOptions) {
        const key = JSON.stringify([
          options.allowedLanguages,
          options.allowedScripts,
          options.allowedCharacters,
        ]);
        let result = policies.get(key);
        if (!result) {
          result = compilePolicy(options);
          policies.set(key, result);
        }
        return result;
      }
      policy(context.options);
      for (const path of await documentPaths(context)) {
        const resolved = context.resolveConfig(path);
        const options = resolved.options;
        if (
          !resolved.enabled ||
          !isDocumentPath(path, options) ||
          !(await context.fs.isFile(path))
        )
          continue;
        const allowed = policy(options);
        const content = await context.fs.readFile(path);
        let line = 1;
        let column = 1;
        let previous = "";
        for (const character of content) {
          if (!allowed(character)) {
            const codePoint = `U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`;
            diagnostics.push({
              ruleId: allowedMarkdownCharactersRule.metadata.id,
              severity: resolved.severity,
              message: `Markdown character ${codePoint} (${JSON.stringify(character)}) is not allowed.`,
              path,
              line,
              column,
              endLine: line,
              endColumn: column + character.length,
              scope: "file",
              metadata: { character, codePoint },
              suggestedFix: {
                message:
                  "Use ASCII, add an allowed language or character, or suppress this word with a reason.",
              },
            });
          }
          if (character === "\r" || character === "\n") {
            if (character !== "\n" || previous !== "\r") line += 1;
            column = 1;
          } else column += character.length;
          previous = character;
        }
      }
      return diagnostics;
    },
  };

function stringList(value: string[] | undefined, name: string): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string")
  ) {
    throw new Error(
      `markdown/allowed-characters: ${name} must be an array of strings`,
    );
  }
  return value;
}

function compilePolicy(
  options: AllowedMarkdownCharactersOptions,
): (character: string) => boolean {
  const scripts = new Set(stringList(options.allowedScripts, "allowedScripts"));
  for (const language of stringList(
    options.allowedLanguages,
    "allowedLanguages",
  )) {
    let locale: Intl.Locale;
    try {
      locale = new Intl.Locale(language);
    } catch {
      throw new Error(
        `markdown/allowed-characters: invalid language tag ${JSON.stringify(language)}`,
      );
    }
    // English is already supported by ASCII; do not enable all Latin characters.
    if (locale.language === "en" && !locale.script) continue;
    const script = locale.maximize().script;
    if (!script)
      throw new Error(
        `markdown/allowed-characters: cannot determine script for ${JSON.stringify(language)}; use allowedScripts or allowedCharacters`,
      );
    for (const entry of compositeScripts[script] ?? [script])
      scripts.add(entry);
  }
  const patterns = [...scripts].map((script) => {
    try {
      if (!/^[A-Za-z_]+$/.test(script)) throw new Error("Invalid script name");
      return new RegExp(`\\p{Script_Extensions=${script}}`, "u");
    } catch {
      throw new Error(
        `markdown/allowed-characters: invalid Unicode script ${JSON.stringify(script)}`,
      );
    }
  });
  const characters = new Set(
    stringList(options.allowedCharacters, "allowedCharacters").flatMap(
      (entry) => Array.from(entry),
    ),
  );
  return (character) => {
    const point = character.codePointAt(0) ?? 0;
    if (
      (point >= 0x20 && point <= 0x7e) ||
      /[\t\r\n]/.test(character) ||
      characters.has(character)
    )
      return true;
    return (
      !/\p{Default_Ignorable_Code_Point}/u.test(character) &&
      /[\p{L}\p{M}\p{N}]/u.test(character) &&
      patterns.some((pattern) => pattern.test(character))
    );
  };
}
