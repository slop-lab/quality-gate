import type { Diagnostic } from "./types.js";

export interface SuppressionDirective {
  command: string;
  ruleIds: string[];
  reason: string;
  offset: number;
  endOffset: number;
  line: number;
  column: number;
}

interface SuppressionRange {
  ruleId: string;
  start: number;
  end: number;
}

/** HTML-comment directives shared by the runner and suppression policy rules. */
export class DocumentSuppressions {
  readonly directives: SuppressionDirective[] = [];
  private readonly ranges: SuppressionRange[] = [];
  private readonly lineStarts = [0];

  constructor(content: string) {
    for (const match of content.matchAll(/\r\n|\r|\n/g)) {
      this.lineStarts.push(match.index + match[0].length);
    }
    const open: Array<{ directive: SuppressionDirective; rules: Set<string> }> =
      [];
    for (const match of content.matchAll(/<!--([\s\S]*?)-->/g)) {
      const body = match[1]?.trim() ?? "";
      const command =
        /^qg-suppress(?:-(?:next-line|line|start|end))?(?=\s|$)/.exec(
          body,
        )?.[0];
      if (!command) continue;
      const argumentsText = body.slice(command.length).trim();
      const colon = argumentsText.indexOf(":");
      const targets = colon < 0 ? argumentsText : argumentsText.slice(0, colon);
      const ruleIds = targets
        .split(/[\s,]+/)
        .filter((id) => /^[\w-]+\/[\w/-]+$/.test(id));
      const offset = match.index;
      const directive: SuppressionDirective = {
        command,
        ruleIds,
        reason: colon < 0 ? "" : argumentsText.slice(colon + 1).trim(),
        offset,
        endOffset: offset + match[0].length,
        ...this.positionAt(offset),
      };
      this.directives.push(directive);
      if (command === "qg-suppress-start") {
        open.push({ directive, rules: new Set(ruleIds) });
      } else if (command === "qg-suppress-end") {
        if (ruleIds.length === 0) {
          const group = open
            .slice()
            .reverse()
            .find((entry) => entry.rules.size > 0);
          if (group) this.closeGroup(group, [...group.rules], offset);
        } else {
          for (const id of ruleIds) {
            const group = open
              .slice()
              .reverse()
              .find((entry) => entry.rules.has(id));
            if (group) this.closeGroup(group, [id], offset);
          }
        }
      } else {
        let start: number;
        let end: number;
        if (command === "qg-suppress") {
          end = offset;
          while (end > 0 && /[\t ]/.test(content[end - 1] ?? "")) end -= 1;
          start = end;
          while (start > 0 && !/\s/u.test(content[start - 1] ?? "")) start -= 1;
        } else {
          const line =
            command === "qg-suppress-next-line"
              ? this.positionAt(directive.endOffset).line + 1
              : directive.line;
          start = this.lineStarts[line - 1] ?? content.length;
          end = this.lineStarts[line] ?? content.length;
        }
        for (const ruleId of ruleIds) this.ranges.push({ ruleId, start, end });
      }
    }
    // An unclosed start directive has no effect: a range must be explicitly paired.
  }

  isSuppressed(diagnostic: Diagnostic): boolean {
    if (diagnostic.suppressible === false || diagnostic.line === undefined)
      return false;
    const start = this.lineStarts[diagnostic.line - 1];
    if (start === undefined) return false;
    const offset = start + (diagnostic.column ?? 1) - 1;
    return this.ranges.some(
      (range) =>
        range.ruleId === diagnostic.ruleId &&
        range.start <= offset &&
        offset < range.end,
    );
  }

  positionAt(offset: number): { line: number; column: number } {
    let low = 0;
    let high = this.lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if ((this.lineStarts[middle] ?? 0) <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - (this.lineStarts[low] ?? 0) + 1 };
  }

  private closeGroup(
    group: { directive: SuppressionDirective; rules: Set<string> },
    ruleIds: string[],
    end: number,
  ): void {
    for (const ruleId of ruleIds) {
      this.ranges.push({ ruleId, start: group.directive.endOffset, end });
      group.rules.delete(ruleId);
    }
  }
}
