// Normalise line endings and fix markdown that was corrupted by older export bugs.
// Lexical's exporter encodes whitespace adjacent to format markers as &#nn; HTML entities
// (e.g. **hello &#32;**) — but a prior version of cleanMarkdownOutput incorrectly stripped
// only the entity and left the trailing space, producing **hello ** which Lexical can no
// longer parse as bold. Fix both forms so old saves render correctly.
export function preprocessMarkdown(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/&#(\d+);/g, (_, c) => {
      const char = String.fromCharCode(parseInt(c, 10));
      return /\s/.test(char) ? char : `&#${c};`;
    })
    .replace(/(?<![*_])(\*{1,3}|_{1,3})\s+([^*_\n]+?)(\1)(?![*_])/g, "$1$2$3")
    .replace(/(?<![*_])(\*{1,3}|_{1,3})([^*_\n]+?)\s+(\1)(?![*_])/g, "$1$2$3");
}
