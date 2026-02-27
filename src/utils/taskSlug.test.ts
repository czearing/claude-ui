import { slugifyTitle, titleFromSlug } from "./taskSlug";

describe("slugifyTitle", () => {
  it("lowercases and hyphenates a simple title", () => {
    expect(slugifyTitle("Fix Login Bug")).toBe("fix-login-bug");
  });

  it("collapses multiple non-alphanumeric chars into one hyphen", () => {
    expect(slugifyTitle("Hello   World!!!")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyTitle("---Fix Bug---")).toBe("fix-bug");
  });

  it("handles special characters", () => {
    expect(slugifyTitle("Fix: handle null & undefined")).toBe(
      "fix-handle-null-undefined",
    );
  });

  it("returns empty string for empty input", () => {
    expect(slugifyTitle("")).toBe("");
  });

  it("returns empty string for only special characters", () => {
    expect(slugifyTitle("!!!")).toBe("");
  });

  it("handles single word", () => {
    expect(slugifyTitle("Refactor")).toBe("refactor");
  });

  it("handles numbers in title", () => {
    expect(slugifyTitle("Step 1 of 3")).toBe("step-1-of-3");
  });
});

describe("titleFromSlug", () => {
  it("title-cases a hyphenated slug", () => {
    expect(titleFromSlug("fix-login-bug")).toBe("Fix Login Bug");
  });

  it("returns TASK-NNN verbatim", () => {
    expect(titleFromSlug("TASK-001")).toBe("TASK-001");
    expect(titleFromSlug("TASK-123")).toBe("TASK-123");
  });

  it("handles single word", () => {
    expect(titleFromSlug("refactor")).toBe("Refactor");
  });

  it("handles empty string", () => {
    expect(titleFromSlug("")).toBe("");
  });

  it("title-cases each word", () => {
    expect(titleFromSlug("add-new-api-endpoint")).toBe("Add New Api Endpoint");
  });

  it("does not treat TASK-abc as legacy id", () => {
    expect(titleFromSlug("TASK-abc")).toBe("TASK Abc");
  });
});
