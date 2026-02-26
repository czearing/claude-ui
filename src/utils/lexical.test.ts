import { extractTextFromLexical } from "./lexical";

// ── helpers ───────────────────────────────────────────────────────────────────

function lexicalDoc(...paragraphs: string[][]): string {
  return JSON.stringify({
    root: {
      type: "root",
      children: paragraphs.map((words) => ({
        type: "paragraph",
        children: words.map((text) => ({ type: "text", text })),
      })),
    },
  });
}

// ── extractTextFromLexical ────────────────────────────────────────────────────

describe("extractTextFromLexical", () => {
  // ── non-JSON input ──────────────────────────────────────────────────────────

  it("returns the raw string when input is not JSON", () => {
    const plain = "Just some plain text.";
    expect(extractTextFromLexical(plain)).toBe(plain);
  });

  it("returns empty string when JSON has no root property (walk receives undefined)", () => {
    // root is undefined → walk returns immediately → empty texts array → ""
    const noRoot = JSON.stringify({ notRoot: {} });
    expect(extractTextFromLexical(noRoot)).toBe("");
  });

  it("returns empty string for an empty input", () => {
    // JSON.parse("") throws, so we get the raw string back
    expect(extractTextFromLexical("")).toBe("");
  });

  // ── valid Lexical JSON ──────────────────────────────────────────────────────

  it("extracts a single text node", () => {
    const doc = JSON.stringify({
      root: {
        type: "root",
        children: [{ type: "text", text: "Hello world" }],
      },
    });
    expect(extractTextFromLexical(doc)).toBe("Hello world");
  });

  it("joins multiple top-level text nodes with newlines", () => {
    const doc = lexicalDoc(["First"], ["Second"]);
    expect(extractTextFromLexical(doc)).toBe("First\nSecond");
  });

  it("collects text nodes from nested paragraph children", () => {
    const doc = JSON.stringify({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Hello " },
              { type: "text", text: "world" },
            ],
          },
        ],
      },
    });
    expect(extractTextFromLexical(doc)).toBe("Hello \nworld");
  });

  it("handles deeply nested children", () => {
    const doc = JSON.stringify({
      root: {
        type: "root",
        children: [
          {
            type: "list",
            children: [
              {
                type: "listitem",
                children: [{ type: "text", text: "Item one" }],
              },
              {
                type: "listitem",
                children: [{ type: "text", text: "Item two" }],
              },
            ],
          },
        ],
      },
    });
    expect(extractTextFromLexical(doc)).toBe("Item one\nItem two");
  });

  it("ignores non-text nodes with no children", () => {
    const doc = JSON.stringify({
      root: {
        type: "root",
        children: [
          { type: "horizontalrule" },
          { type: "text", text: "After rule" },
        ],
      },
    });
    expect(extractTextFromLexical(doc)).toBe("After rule");
  });

  it("skips nodes where 'text' is not a string", () => {
    const doc = JSON.stringify({
      root: {
        type: "root",
        children: [
          { type: "text", text: 42 }, // text is a number — skip
          { type: "text", text: "Valid" },
        ],
      },
    });
    expect(extractTextFromLexical(doc)).toBe("Valid");
  });

  it("returns empty string for an empty root children array", () => {
    const doc = JSON.stringify({ root: { type: "root", children: [] } });
    expect(extractTextFromLexical(doc)).toBe("");
  });

  it("handles null children entries without throwing", () => {
    const doc = JSON.stringify({
      root: {
        type: "root",
        children: [null, { type: "text", text: "After null" }],
      },
    });
    expect(extractTextFromLexical(doc)).toBe("After null");
  });

  // ── realistic Lexical editor state ──────────────────────────────────────────

  it("extracts text from a realistic Lexical editor state", () => {
    const doc = JSON.stringify({
      root: {
        type: "root",
        version: 1,
        children: [
          {
            type: "paragraph",
            version: 1,
            children: [
              { type: "text", version: 1, text: "Implement the login page" },
            ],
            direction: "ltr",
          },
          {
            type: "paragraph",
            version: 1,
            children: [
              {
                type: "text",
                version: 1,
                text: "Add OAuth support with Google.",
              },
            ],
            direction: "ltr",
          },
        ],
        direction: "ltr",
      },
    });

    expect(extractTextFromLexical(doc)).toBe(
      "Implement the login page\nAdd OAuth support with Google.",
    );
  });
});
