/**
 * Shared parser/serializer for simple markdown documents with YAML-like
 * frontmatter used by both skills and agents.
 *
 * Format:
 *   ---
 *   name: my-skill
 *   description: Does something useful
 *   ---
 *
 *   Body content here.
 */

export interface FrontmatterDoc {
  name: string;
  description: string;
  content: string;
}

/**
 * Parse a raw markdown string into a FrontmatterDoc.
 *
 * When the frontmatter delimiters are absent, the entire raw string is
 * treated as the body content with an empty description.
 *
 * Handles both LF and CRLF line endings.
 */
export function parseFrontmatterDoc(raw: string, name: string): FrontmatterDoc {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    return { name, description: "", content: raw.trim() };
  }
  const front = m[1];
  const body = m[2].trim();
  const descMatch = front.match(/^description:\s*(.+)$/m);
  return {
    name,
    description: descMatch ? descMatch[1].trim() : "",
    content: body,
  };
}

/**
 * Serialize a FrontmatterDoc back to the markdown file format.
 * Round-trips cleanly with parseFrontmatterDoc (for LF files).
 */
export function serializeFrontmatterDoc(doc: FrontmatterDoc): string {
  return `---\nname: ${doc.name}\ndescription: ${doc.description}\n---\n\n${doc.content}`;
}
