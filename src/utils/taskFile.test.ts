import type { Task } from "./tasks.types";
import { parseTaskFile, serializeTaskFile } from "./taskFile";

// ── fixtures ──────────────────────────────────────────────────────────────────

const MINIMAL_TASK: Task = {
  id: "TASK-001",
  title: "Do the thing",
  status: "Backlog",
  priority: "Medium",
  repoId: "repo-abc",
  spec: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const FULL_TASK: Task = {
  ...MINIMAL_TASK,
  id: "TASK-042",
  title: "Implement feature X",
  status: "In Progress",
  priority: "High",
  sessionId: "sess-xyz",
  spec: "## Goal\n\nBuild the thing.",
  createdAt: "2026-02-01T10:00:00.000Z",
  updatedAt: "2026-02-15T12:00:00.000Z",
};

const ARCHIVED_TASK: Task = {
  ...MINIMAL_TASK,
  status: "Done",
  archivedAt: "2026-03-01T09:00:00.000Z",
};

// ── parseTaskFile ─────────────────────────────────────────────────────────────

describe("parseTaskFile", () => {
  it("parses all required fields from valid frontmatter", () => {
    const content = [
      "---",
      "id: TASK-001",
      "title: Do the thing",
      "status: Backlog",
      "priority: Medium",
      "repoId: repo-abc",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-02T00:00:00.000Z",
      "---",
      "",
    ].join("\n");

    const task = parseTaskFile(content);

    expect(task.id).toBe("TASK-001");
    expect(task.title).toBe("Do the thing");
    expect(task.status).toBe("Backlog");
    expect(task.priority).toBe("Medium");
    expect(task.repoId).toBe("repo-abc");
    expect(task.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(task.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("captures the body as spec (trimmed)", () => {
    const content = [
      "---",
      "id: TASK-001",
      "title: T",
      "status: Backlog",
      "priority: Low",
      "repoId: r",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
      "## Goal",
      "",
      "Build the thing.",
    ].join("\n");

    const task = parseTaskFile(content);
    expect(task.spec).toBe("## Goal\n\nBuild the thing.");
  });

  it("returns empty string spec when the body is blank", () => {
    const content = [
      "---",
      "id: TASK-001",
      "title: T",
      "status: Backlog",
      "priority: Low",
      "repoId: r",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
    ].join("\n");

    expect(parseTaskFile(content).spec).toBe("");
  });

  it("defaults status to Backlog when missing", () => {
    const content = [
      "---",
      "id: TASK-001",
      "title: T",
      "priority: Low",
      "repoId: r",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
    ].join("\n");

    expect(parseTaskFile(content).status).toBe("Backlog");
  });

  it("defaults priority to Medium when missing", () => {
    const content = [
      "---",
      "id: TASK-001",
      "title: T",
      "status: Not Started",
      "repoId: r",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
    ].join("\n");

    expect(parseTaskFile(content).priority).toBe("Medium");
  });

  it("includes sessionId when present", () => {
    const content = [
      "---",
      "id: TASK-001",
      "title: T",
      "status: In Progress",
      "priority: High",
      "repoId: r",
      "sessionId: sess-abc",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
    ].join("\n");

    expect(parseTaskFile(content).sessionId).toBe("sess-abc");
  });

  it("omits sessionId when not in frontmatter", () => {
    const task = parseTaskFile(serializeTaskFile(MINIMAL_TASK));
    expect(task.sessionId).toBeUndefined();
  });

  it("includes archivedAt when present", () => {
    const content = [
      "---",
      "id: TASK-001",
      "title: T",
      "status: Done",
      "priority: Low",
      "repoId: r",
      "archivedAt: 2026-03-01T09:00:00.000Z",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
    ].join("\n");

    expect(parseTaskFile(content).archivedAt).toBe("2026-03-01T09:00:00.000Z");
  });

  it("omits archivedAt when not in frontmatter", () => {
    const task = parseTaskFile(serializeTaskFile(MINIMAL_TASK));
    expect(task.archivedAt).toBeUndefined();
  });

  it("throws when frontmatter delimiters are absent", () => {
    expect(() => parseTaskFile("no frontmatter here")).toThrow(
      "Invalid task file: missing frontmatter",
    );
  });

  it("ignores frontmatter lines that lack ': ' separator", () => {
    const content = [
      "---",
      "id: TASK-001",
      "this-line-has-no-colon-space",
      "title: Valid Title",
      "status: Backlog",
      "priority: Low",
      "repoId: r",
      "createdAt: 2026-01-01T00:00:00.000Z",
      "updatedAt: 2026-01-01T00:00:00.000Z",
      "---",
      "",
    ].join("\n");

    // Should not throw, and should still parse valid fields
    const task = parseTaskFile(content);
    expect(task.title).toBe("Valid Title");
  });
});

// ── serializeTaskFile ─────────────────────────────────────────────────────────

describe("serializeTaskFile", () => {
  it("produces frontmatter with all required fields", () => {
    const out = serializeTaskFile(MINIMAL_TASK);
    expect(out).toContain("id: TASK-001");
    expect(out).toContain("title: Do the thing");
    expect(out).toContain("status: Backlog");
    expect(out).toContain("priority: Medium");
    expect(out).toContain("repoId: repo-abc");
    expect(out).toContain("createdAt: 2026-01-01T00:00:00.000Z");
    expect(out).toContain("updatedAt: 2026-01-02T00:00:00.000Z");
  });

  it("wraps content in --- delimiters", () => {
    const out = serializeTaskFile(MINIMAL_TASK);
    expect(out.startsWith("---\n")).toBe(true);
    expect(out).toContain("\n---\n");
  });

  it("includes sessionId when present", () => {
    expect(serializeTaskFile(FULL_TASK)).toContain("sessionId: sess-xyz");
  });

  it("omits sessionId line when absent", () => {
    expect(serializeTaskFile(MINIMAL_TASK)).not.toContain("sessionId:");
  });

  it("includes archivedAt when present", () => {
    expect(serializeTaskFile(ARCHIVED_TASK)).toContain(
      "archivedAt: 2026-03-01T09:00:00.000Z",
    );
  });

  it("omits archivedAt line when absent", () => {
    expect(serializeTaskFile(MINIMAL_TASK)).not.toContain("archivedAt:");
  });

  it("appends the spec body after the closing ---", () => {
    const out = serializeTaskFile(FULL_TASK);
    expect(out.endsWith("## Goal\n\nBuild the thing.")).toBe(true);
  });

  it("does not append a body section when spec is empty", () => {
    const out = serializeTaskFile(MINIMAL_TASK);
    // After the closing ---, there should only be a blank line and nothing else
    const afterDelimiter = out.split("\n---\n")[1];
    expect(afterDelimiter?.trim()).toBe("");
  });
});

// ── round-trip ────────────────────────────────────────────────────────────────

describe("round-trip: serialize → parse", () => {
  it("preserves all fields for a minimal task", () => {
    const parsed = parseTaskFile(serializeTaskFile(MINIMAL_TASK));
    expect(parsed).toEqual(MINIMAL_TASK);
  });

  it("preserves all fields for a task with sessionId and spec", () => {
    const parsed = parseTaskFile(serializeTaskFile(FULL_TASK));
    expect(parsed).toEqual(FULL_TASK);
  });

  it("preserves all fields for an archived task", () => {
    const parsed = parseTaskFile(serializeTaskFile(ARCHIVED_TASK));
    expect(parsed).toEqual(ARCHIVED_TASK);
  });
});
