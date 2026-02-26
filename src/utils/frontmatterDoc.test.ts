import {
  parseFrontmatterDoc,
  serializeFrontmatterDoc,
  type FrontmatterDoc,
} from "./frontmatterDoc";

// ── parseFrontmatterDoc ───────────────────────────────────────────────────────

describe("parseFrontmatterDoc", () => {
  it("parses name (from parameter), description, and content", () => {
    const raw = [
      "---",
      "name: my-skill",
      "description: Does something useful",
      "---",
      "",
      "Skill body here.",
    ].join("\n");

    const doc = parseFrontmatterDoc(raw, "my-skill");
    expect(doc.name).toBe("my-skill");
    expect(doc.description).toBe("Does something useful");
    expect(doc.content).toBe("Skill body here.");
  });

  it("trims whitespace from description value", () => {
    const raw = ["---", "description:   lots of spaces   ", "---", ""].join(
      "\n",
    );
    const doc = parseFrontmatterDoc(raw, "x");
    expect(doc.description).toBe("lots of spaces");
  });

  it("returns empty description when the field is absent", () => {
    const raw = ["---", "name: x", "---", "", "content"].join("\n");
    const doc = parseFrontmatterDoc(raw, "x");
    expect(doc.description).toBe("");
  });

  it("returns raw input as content when frontmatter delimiters are absent", () => {
    const raw = "no frontmatter here";
    const doc = parseFrontmatterDoc(raw, "fallback");
    expect(doc.name).toBe("fallback");
    expect(doc.description).toBe("");
    expect(doc.content).toBe("no frontmatter here");
  });

  it("handles CRLF line endings", () => {
    const raw =
      "---\r\nname: skill\r\ndescription: crlf doc\r\n---\r\n\r\nbody";
    const doc = parseFrontmatterDoc(raw, "skill");
    expect(doc.description).toBe("crlf doc");
    expect(doc.content).toBe("body");
  });

  it("trims the body content", () => {
    const raw = ["---", "description: d", "---", "", "  body  "].join("\n");
    const doc = parseFrontmatterDoc(raw, "x");
    expect(doc.content).toBe("body");
  });

  it("returns empty content for a body-less document", () => {
    const raw = ["---", "description: d", "---"].join("\n");
    const doc = parseFrontmatterDoc(raw, "x");
    expect(doc.content).toBe("");
  });
});

// ── serializeFrontmatterDoc ───────────────────────────────────────────────────

describe("serializeFrontmatterDoc", () => {
  const doc: FrontmatterDoc = {
    name: "my-agent",
    description: "A helpful agent",
    content: "You are an expert...",
  };

  it("starts with ---", () => {
    expect(serializeFrontmatterDoc(doc).startsWith("---\n")).toBe(true);
  });

  it("includes name in frontmatter", () => {
    expect(serializeFrontmatterDoc(doc)).toContain("name: my-agent");
  });

  it("includes description in frontmatter", () => {
    expect(serializeFrontmatterDoc(doc)).toContain(
      "description: A helpful agent",
    );
  });

  it("separates frontmatter from body with ---", () => {
    const out = serializeFrontmatterDoc(doc);
    expect(out).toContain("\n---\n");
  });

  it("appends the content body", () => {
    const out = serializeFrontmatterDoc(doc);
    expect(out.endsWith("You are an expert...")).toBe(true);
  });
});

// ── round-trip ────────────────────────────────────────────────────────────────

describe("round-trip: serialize → parse", () => {
  it("preserves name, description, and content", () => {
    const original: FrontmatterDoc = {
      name: "summarizer",
      description: "Summarizes long documents",
      content: "When given a document, produce a concise summary.",
    };

    const parsed = parseFrontmatterDoc(
      serializeFrontmatterDoc(original),
      original.name,
    );

    expect(parsed).toEqual(original);
  });

  it("preserves an empty description", () => {
    const original: FrontmatterDoc = {
      name: "minimal",
      description: "",
      content: "body",
    };
    const parsed = parseFrontmatterDoc(
      serializeFrontmatterDoc(original),
      original.name,
    );
    expect(parsed.description).toBe("");
  });
});
