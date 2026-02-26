/**
 * Extract plain text from a Lexical editor state JSON string by walking
 * the node tree and collecting all "text" node values.
 *
 * Returns the raw input string unchanged when it is not valid Lexical JSON
 * (e.g. already plain text, or corrupted data).
 */
export function extractTextFromLexical(specJson: string): string {
  try {
    const state = JSON.parse(specJson) as { root: { children: unknown[] } };
    const texts: string[] = [];

    function walk(node: unknown): void {
      if (typeof node !== "object" || node === null) {
        return;
      }
      const n = node as Record<string, unknown>;
      if (n["type"] === "text" && typeof n["text"] === "string") {
        texts.push(n["text"]);
      }
      if (Array.isArray(n["children"])) {
        (n["children"] as unknown[]).forEach(walk);
      }
    }

    walk(state.root);
    return texts.join("\n");
  } catch {
    return specJson;
  }
}
