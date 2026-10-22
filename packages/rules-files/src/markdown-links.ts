import { fromMarkdown } from "mdast-util-from-markdown";

export interface MarkdownReference {
  reference: string;
  line: number;
  column: number;
}

interface Node {
  type: string;
  url?: string;
  identifier?: string;
  children?: Node[];
  position?: { start: { line: number; column: number } };
}

/** Parse real links and images, leaving code, comments, and prose alone. */
export function markdownReferences(content: string): MarkdownReference[] {
  const root = fromMarkdown(content);
  const definitions = new Map<string, string>();
  function visit(node: Node, callback: (node: Node) => void) {
    callback(node);
    for (const child of node.children ?? []) visit(child, callback);
  }
  visit(root, (node) => {
    if (
      node.type === "definition" &&
      node.identifier &&
      node.url !== undefined
    ) {
      const key = node.identifier.toUpperCase();
      if (!definitions.has(key)) definitions.set(key, node.url);
    }
  });
  const references: MarkdownReference[] = [];
  visit(root, (node) => {
    const reference =
      node.type === "link" || node.type === "image"
        ? node.url
        : (node.type === "linkReference" || node.type === "imageReference") &&
            node.identifier
          ? definitions.get(node.identifier.toUpperCase())
          : undefined;
    if (reference === undefined) return;
    references.push({
      reference,
      line: node.position?.start.line ?? 1,
      column: node.position?.start.column ?? 1,
    });
  });
  return references;
}
