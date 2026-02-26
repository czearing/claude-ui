import { preprocessMarkdown } from "./preprocessMarkdown";

describe("preprocessMarkdown", () => {
  // ── line-ending normalisation ──────────────────────────────────────────────

  it("converts CRLF to LF", () => {
    expect(preprocessMarkdown("line1\r\nline2")).toBe("line1\nline2");
  });

  it("leaves LF-only content unchanged", () => {
    expect(preprocessMarkdown("line1\nline2")).toBe("line1\nline2");
  });

  it("normalises mixed CRLF + LF line endings", () => {
    expect(preprocessMarkdown("a\r\nb\nc\r\nd")).toBe("a\nb\nc\nd");
  });

  // ── HTML entity decoding ───────────────────────────────────────────────────

  it("decodes &#32; (space) to a literal space", () => {
    expect(preprocessMarkdown("&#32;")).toBe(" ");
  });

  it("decodes &#9; (tab) to a literal tab", () => {
    expect(preprocessMarkdown("&#9;")).toBe("\t");
  });

  it("decodes &#10; (newline) to a literal newline", () => {
    expect(preprocessMarkdown("&#10;")).toBe("\n");
  });

  it("preserves non-whitespace numeric entities unchanged", () => {
    // &#65; = 'A' — not whitespace → must not be decoded
    expect(preprocessMarkdown("&#65;")).toBe("&#65;");
    // &#60; = '<' — not whitespace → must not be decoded
    expect(preprocessMarkdown("&#60;")).toBe("&#60;");
  });

  // ── trailing-whitespace removal inside inline markers ─────────────────────

  it("removes the trailing space before a closing ** marker", () => {
    expect(preprocessMarkdown("**hello **")).toBe("**hello**");
  });

  it("removes the trailing space before a closing * marker", () => {
    expect(preprocessMarkdown("*hello *")).toBe("*hello*");
  });

  it("removes the trailing space before a closing *** marker", () => {
    expect(preprocessMarkdown("***hello ***")).toBe("***hello***");
  });

  it("removes the trailing space before a closing __ marker", () => {
    expect(preprocessMarkdown("__hello __")).toBe("__hello__");
  });

  // ── leading-whitespace removal inside inline markers ──────────────────────

  it("removes the leading space after an opening ** marker", () => {
    expect(preprocessMarkdown("** hello**")).toBe("**hello**");
  });

  it("removes the leading space after an opening * marker", () => {
    expect(preprocessMarkdown("* hello*")).toBe("*hello*");
  });

  it("removes the leading space after an opening _ marker", () => {
    expect(preprocessMarkdown("_ hello_")).toBe("_hello_");
  });

  // ── both leading and trailing whitespace ──────────────────────────────────

  it("removes both leading and trailing spaces from ** markers", () => {
    expect(preprocessMarkdown("** hello **")).toBe("**hello**");
  });

  // ── Lexical export regression: entity adjacent to closing marker ───────────
  // Lexical's markdown exporter encodes adjacent whitespace as &#32; etc.
  // An old export bug left these partially decoded, producing e.g. "**hello **".
  // preprocessMarkdown must handle both the encoded and decoded forms.

  it("fixes Lexical export corruption: **hello &#32;**", () => {
    // &#32; decodes to a space → "**hello **" → trailing space removed → "**hello**"
    expect(preprocessMarkdown("**hello &#32;**")).toBe("**hello**");
  });

  it("fixes Lexical export corruption: &#32;**hello**", () => {
    // entity is outside the marker — just decode it to a space
    expect(preprocessMarkdown("&#32;**hello**")).toBe(" **hello**");
  });

  it("fixes corruption: *text &#32;* in italic marker", () => {
    expect(preprocessMarkdown("*text &#32;*")).toBe("*text*");
  });

  // ── unchanged inputs ───────────────────────────────────────────────────────

  it("returns an empty string unchanged", () => {
    expect(preprocessMarkdown("")).toBe("");
  });

  it("returns plain text (no markers) unchanged", () => {
    const plain = "This is a normal sentence without any formatting.";
    expect(preprocessMarkdown(plain)).toBe(plain);
  });

  it("does not alter correctly-formatted markers", () => {
    expect(preprocessMarkdown("**hello**")).toBe("**hello**");
    expect(preprocessMarkdown("*world*")).toBe("*world*");
    expect(preprocessMarkdown("***bold-italic***")).toBe("***bold-italic***");
  });

  it("does not alter markers that span multiple words without extra spaces", () => {
    expect(preprocessMarkdown("**hello world**")).toBe("**hello world**");
  });

  // ── combination: CRLF + entities + marker cleanup ─────────────────────────

  it("handles all transformations in a single document", () => {
    const input = "# Title\r\n\r\n**bold &#32;** and *italic &#32;*\r\n";
    const output = preprocessMarkdown(input);
    expect(output).toBe("# Title\n\n**bold** and *italic*\n");
  });
});
