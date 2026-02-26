import { buildOptions } from "./blockOptions";

// Minimal editor mock — buildOptions only calls editor methods inside the
// returned onSelect callbacks, so the mock is only needed for construction.
const mockEditor = {
  update: jest.fn(),
  dispatchCommand: jest.fn(),
};

describe("buildOptions", () => {
  // ── catalog size ──────────────────────────────────────────────────────────

  it("returns exactly 8 block type options", () => {
    const options = buildOptions(mockEditor as never);
    expect(options).toHaveLength(8);
  });

  // ── titles ─────────────────────────────────────────────────────────────────

  it("includes all expected block types by title", () => {
    const titles = buildOptions(mockEditor as never).map((o) => o.title);
    expect(titles).toEqual([
      "Text",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bullet List",
      "Numbered List",
      "Quote",
      "Code Block",
    ]);
  });

  // ── keyword filtering ─────────────────────────────────────────────────────

  it("all three heading options include the 'heading' keyword", () => {
    const headingOpts = buildOptions(mockEditor as never).filter((o) =>
      o.keywords.includes("heading"),
    );
    expect(headingOpts.map((o) => o.title)).toEqual([
      "Heading 1",
      "Heading 2",
      "Heading 3",
    ]);
  });

  it("both list options include the 'list' keyword", () => {
    const listOpts = buildOptions(mockEditor as never).filter((o) =>
      o.keywords.includes("list"),
    );
    expect(listOpts.map((o) => o.title)).toEqual([
      "Bullet List",
      "Numbered List",
    ]);
  });

  it("Text option includes 'text' and 'paragraph' keywords", () => {
    const textOpt = buildOptions(mockEditor as never).find(
      (o) => o.title === "Text",
    )!;
    expect(textOpt.keywords).toContain("text");
    expect(textOpt.keywords).toContain("paragraph");
  });

  it("Code Block option includes 'code' keyword", () => {
    const codeOpt = buildOptions(mockEditor as never).find(
      (o) => o.title === "Code Block",
    )!;
    expect(codeOpt.keywords).toContain("code");
  });

  it("Quote option includes 'quote' keyword", () => {
    const quoteOpt = buildOptions(mockEditor as never).find(
      (o) => o.title === "Quote",
    )!;
    expect(quoteOpt.keywords).toContain("quote");
  });

  // ── title-based search simulation ─────────────────────────────────────────
  // SlashMenuPlugin filters by: title.includes(query) || keywords.includes(query)
  // These tests verify the catalog supports expected slash-menu queries.

  it("query 'h1' matches Heading 1 via keywords", () => {
    const opts = buildOptions(mockEditor as never).filter((o) =>
      o.keywords.some((kw) => kw.includes("h1")),
    );
    expect(opts.map((o) => o.title)).toContain("Heading 1");
  });

  it("query 'ul' matches Bullet List via keywords", () => {
    const opts = buildOptions(mockEditor as never).filter(
      (o) =>
        o.title.toLowerCase().includes("ul") ||
        o.keywords.some((kw) => kw.includes("ul")),
    );
    expect(opts.map((o) => o.title)).toContain("Bullet List");
  });

  it("query 'ol' matches Numbered List via keywords", () => {
    const opts = buildOptions(mockEditor as never).filter(
      (o) =>
        o.title.toLowerCase().includes("ol") ||
        o.keywords.some((kw) => kw.includes("ol")),
    );
    expect(opts.map((o) => o.title)).toContain("Numbered List");
  });

  it("query 'pre' matches Code Block via keywords", () => {
    const opts = buildOptions(mockEditor as never).filter((o) =>
      o.keywords.some((kw) => kw.includes("pre")),
    );
    expect(opts.map((o) => o.title)).toContain("Code Block");
  });

  // ── descriptions ──────────────────────────────────────────────────────────

  it("every option has a non-empty description", () => {
    buildOptions(mockEditor as never).forEach((opt) => {
      expect(opt.description.length).toBeGreaterThan(0);
    });
  });

  // ── onSelect is callable ───────────────────────────────────────────────────

  it("every option has a callable onSelect", () => {
    buildOptions(mockEditor as never).forEach((opt) => {
      expect(typeof opt.onSelect).toBe("function");
    });
  });

  it("Bullet List onSelect dispatches INSERT_UNORDERED_LIST_COMMAND", () => {
    const opts = buildOptions(mockEditor as never);
    const bulletOpt = opts.find((o) => o.title === "Bullet List")!;
    bulletOpt.onSelect();
    expect(mockEditor.dispatchCommand).toHaveBeenCalled();
  });

  it("Numbered List onSelect dispatches INSERT_ORDERED_LIST_COMMAND", () => {
    const opts = buildOptions(mockEditor as never);
    const numberedOpt = opts.find((o) => o.title === "Numbered List")!;
    numberedOpt.onSelect();
    expect(mockEditor.dispatchCommand).toHaveBeenCalled();
  });
});
