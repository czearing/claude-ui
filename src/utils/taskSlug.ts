const LEGACY_ID_RE = /^TASK-\d+$/;

/**
 * Convert a human-readable title into a URL/filename-safe slug.
 *
 * - Lowercase
 * - Replace runs of non-alphanumeric characters with a single hyphen
 * - Trim leading/trailing hyphens
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derive a display title from a filename slug.
 *
 * - Legacy `TASK-NNN` ids are returned verbatim.
 * - Otherwise replace hyphens with spaces and title-case each word.
 */
export function titleFromSlug(slug: string): string {
  if (LEGACY_ID_RE.test(slug)) {
    return slug;
  }
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
