/**
 * Reads a string field from a parsed request body.
 * Returns the string value (optionally trimmed), or `fallback` if missing/wrong type.
 */
export function parseStringBody(
  body: Record<string, unknown>,
  key: string,
  opts: { trim?: boolean; fallback?: string } = {},
): string {
  const { trim = false, fallback = "" } = opts;
  const val = body[key];
  if (typeof val !== "string") {return fallback;}
  return trim ? val.trim() : val;
}
