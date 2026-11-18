import type { Diagnostic, Rule } from "@slop-lab/qg-core";
import stringWidth from "string-width";
import {
  type DocumentFileOptions,
  documentPaths,
  isDocumentPath,
} from "./document-files.js";

interface TableCell {
  value: string;
  line: number;
  start: number;
  end: number;
}

interface MarkdownTable {
  header: TableCell[];
  delimiters: string[];
  body: TableCell[][];
}

export const noExtraTableCellWhitespaceRule: Rule<DocumentFileOptions> = {
  metadata: {
    id: "markdown/no-extra-table-cell-whitespace",
    name: "No extra Markdown table cell whitespace",
    description:
      "Reports repeated padding that does not align Markdown table columns.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "file",
    requires: ["fileContent"],
    fixable: "suggestion",
    defaultOptions: {},
    ignoreGeneratedArtifacts: true,
  },
  async check(context) {
    return checkMarkdownTables(context, (tables, path, severity) => {
      const diagnostics: Diagnostic[] = [];
      for (const table of tables) {
        for (const row of [table.header, ...table.body]) {
          for (const [index, cell] of row.entries()) {
            const leading = cell.value.match(/^[ \t]+/)?.[0] ?? "";
            const empty = leading.length === cell.value.length;
            const trailing = empty
              ? ""
              : (cell.value.match(/[ \t]+$/)?.[0] ?? "");
            const compactLeading = empty ? 2 : 1;
            if (leading.length <= compactLeading && trailing.length <= 1)
              continue;
            const [alignedLeading, alignedTrailing] = alignmentPadding(
              cell.value.slice(
                leading.length,
                cell.value.length - trailing.length,
              ),
              table.delimiters[index],
            );
            const leadingLimit = paddingLimit(
              leading,
              alignedLeading,
              compactLeading,
            );
            const trailingLimit = paddingLimit(trailing, alignedTrailing, 1);
            for (const violation of [
              leading.length > leadingLimit
                ? {
                    column: cell.start + leadingLimit + 1,
                    endColumn: cell.start + leading.length + 1,
                  }
                : undefined,
              trailing.length > trailingLimit
                ? {
                    column: cell.end - trailing.length + 1,
                    endColumn: cell.end - trailingLimit + 1,
                  }
                : undefined,
            ]) {
              if (!violation) continue;
              diagnostics.push({
                ruleId: noExtraTableCellWhitespaceRule.metadata.id,
                severity,
                message:
                  "Repeated Markdown table cell padding does not align with the delimiter row.",
                path,
                line: cell.line,
                ...violation,
                scope: "file",
                suggestedFix: {
                  message:
                    "Remove the extra padding or align the cell with the delimiter row.",
                },
              });
            }
          }
        }
      }
      return diagnostics;
    });
  },
};

function alignmentPadding(
  content: string,
  delimiter: string | undefined,
): [leading: number, trailing: number] {
  if (!delimiter) return [0, 0];
  if (!content) return [delimiter.length + 2, 0];
  const extra = delimiter.length - stringWidth(content);
  if (extra < 0) return [0, 0];

  let before = 0;
  if (delimiter.endsWith(":"))
    before = delimiter.startsWith(":") ? Math.floor(extra / 2) : extra;
  return [before + 1, extra - before + 1];
}

function paddingLimit(
  padding: string,
  aligned: number,
  compact: number,
): number {
  return padding.length >= aligned && !padding.includes("\t")
    ? Math.max(aligned, compact)
    : compact;
}

export const noRedundantTableRowNumbersRule: Rule<DocumentFileOptions> = {
  metadata: {
    id: "markdown/no-redundant-table-row-numbers",
    name: "No redundant Markdown table row numbers",
    description:
      "Reports sequential first-column row numbers that duplicate visible table order.",
    defaultSeverity: "error",
    supports: ["changed", "full"],
    scope: "file",
    requires: ["fileContent"],
    fixable: "suggestion",
    defaultOptions: {},
    ignoreGeneratedArtifacts: true,
  },
  async check(context) {
    return checkMarkdownTables(context, (tables, path, severity) => {
      const diagnostics: Diagnostic[] = [];
      for (const table of tables) {
        const numberedHeader = /^(?:#|no\.?|number|order|row)$/i.test(
          table.header[0]?.value.trim() ?? "",
        );
        const numberedCells = table.body.map((row) => row[0]);
        if (!numberedHeader) continue;
        for (const cell of numberedCells) {
          if (!cell || !/^\d+$/.test(cell.value.trim())) continue;
          const value = cell.value.trim();
          const offset = cell.value.indexOf(value);
          diagnostics.push({
            ruleId: noRedundantTableRowNumbersRule.metadata.id,
            severity,
            message:
              "Markdown table row number is redundant because row order is already visible.",
            path,
            line: cell.line,
            column: cell.start + offset + 1,
            endLine: cell.line,
            endColumn: cell.start + offset + value.length + 1,
            scope: "file",
            suggestedFix: {
              message: "Remove the row-number column from the table.",
            },
          });
        }
      }
      return diagnostics;
    });
  },
};

async function checkMarkdownTables(
  context: Parameters<Rule<DocumentFileOptions>["check"]>[0],
  inspect: (
    tables: MarkdownTable[],
    path: string,
    severity: Diagnostic["severity"],
  ) => Diagnostic[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const path of await documentPaths(context)) {
    const resolved = context.resolveConfig(path);
    if (
      !resolved.enabled ||
      !isDocumentPath(path, resolved.options) ||
      !(await context.fs.isFile(path))
    )
      continue;
    diagnostics.push(
      ...inspect(
        markdownTables(await context.fs.readFile(path)),
        path,
        resolved.severity,
      ),
    );
  }
  return diagnostics;
}

function markdownTables(content: string): MarkdownTable[] {
  const lines = content.split(/\r?\n/);
  const fenced = fencedLines(lines);
  const tables: MarkdownTable[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (fenced.has(index - 1) || fenced.has(index)) continue;
    const header = tableCells(lines[index - 1] ?? "", index);
    const delimiters = tableCells(lines[index] ?? "", index + 1).map((cell) =>
      cell.value.trim(),
    );
    if (
      header.length < 2 ||
      delimiters.length !== header.length ||
      !delimiters.every((delimiter) => /^:?-+:?$/.test(delimiter))
    )
      continue;
    const body: TableCell[][] = [];
    let next = index + 1;
    while (next < lines.length && !fenced.has(next)) {
      const cells = tableCells(lines[next] ?? "", next + 1);
      if (cells.length === 0) break;
      body.push(cells);
      next += 1;
    }
    tables.push({ header, delimiters, body });
    index = next - 1;
  }
  return tables;
}

function tableCells(line: string, lineNumber: number): TableCell[] {
  if (/^(?: {4}|\t)/.test(line)) return [];
  const pipes = pipeOffsets(line);
  if (pipes.length === 0) return [];
  const first = line.search(/\S/);
  const last = line.search(/\S\s*$/);
  const boundaries = [...pipes];
  if (first !== pipes[0]) boundaries.unshift(-1);
  if (last !== pipes[pipes.length - 1]) boundaries.push(line.length);
  if (boundaries.length < 3) return [];
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1] ?? line.length;
    return {
      value: line.slice(start + 1, end),
      line: lineNumber,
      start: start + 1,
      end,
    };
  });
}

function pipeOffsets(line: string): number[] {
  const offsets: number[] = [];
  let codeTicks = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "`") {
      let end = index + 1;
      while (line[end] === "`") end += 1;
      const count = end - index;
      if (codeTicks === 0) codeTicks = count;
      else if (codeTicks === count) codeTicks = 0;
      index = end - 1;
      continue;
    }
    if (line[index] !== "|" || codeTicks !== 0) continue;
    let escapes = 0;
    for (
      let before = index - 1;
      before >= 0 && line[before] === "\\";
      before -= 1
    )
      escapes += 1;
    if (escapes % 2 === 0) offsets.push(index);
  }
  return offsets;
}

function fencedLines(lines: string[]): Set<number> {
  const result = new Set<number>();
  let fence: { marker: string; length: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence) {
      if (!match) continue;
      fence = { marker: match[1]?.[0] ?? "", length: match[1]?.length ?? 0 };
      result.add(index);
      continue;
    }
    result.add(index);
    if (
      match?.[1]?.[0] === fence.marker &&
      match[1].length >= fence.length &&
      /^\s*$/.test(line.slice(match[0].length))
    )
      fence = undefined;
  }
  return result;
}
