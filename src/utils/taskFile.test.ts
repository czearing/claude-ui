import { parseTaskFile, serializeTaskFile } from "./taskFile";
import type { Task } from "./tasks.types";

// ── fixtures ──────────────────────────────────────────────────────────────────

const MINIMAL_TASK: Task = {
  id: "fix-login-bug",
  title: "Fix Login Bug",
  status: "Backlog",
  repo: "test-repo",
  spec: "",
};

const FULL_TASK: Task = {
  ...MINIMAL_TASK,
  id: "implement-feature-x",
  title: "Implement Feature X",
  status: "In Progress",
  spec: "## Goal\n\nBuild the thing.",
};

const LEGACY_TASK: Task = {
  ...MINIMAL_TASK,
  id: "TASK-042",
  title: "TASK-042",
};

// ── parseTaskFile ─────────────────────────────────────────────────────────────

describe("parseTaskFile", () => {
  it("derives title from the id slug", () => {
    const task = parseTaskFile("some content", "test-repo", "fix-login-bug");

    expect(task.title).toBe("Fix Login Bug");
  });

  it("preserves TASK-NNN ids as title verbatim", () => {
    const task = parseTaskFile("content", "test-repo", "TASK-042");

    expect(task.title).toBe("TASK-042");
  });

  it("sets spec to trimmed content", () => {
    const task = parseTaskFile(
      "\n  ## Goal\n\nBuild the thing.  \n",
      "test-repo",
      "fix-bug",
    );

    expect(task.spec).toBe("## Goal\n\nBuild the thing.");
  });

  it("returns empty spec for empty content", () => {
    const task = parseTaskFile("", "test-repo", "fix-bug");

    expect(task.spec).toBe("");
  });

  it("returns empty spec for whitespace-only content", () => {
    const task = parseTaskFile("   \n  \n  ", "test-repo", "fix-bug");

    expect(task.spec).toBe("");
  });

  it("uses provided status", () => {
    const task = parseTaskFile("spec", "test-repo", "fix-bug", "In Progress");

    expect(task.status).toBe("In Progress");
  });

  it("defaults status to Backlog", () => {
    const task = parseTaskFile("spec", "test-repo", "fix-bug");

    expect(task.status).toBe("Backlog");
  });

  it("sets repo from parameter", () => {
    const task = parseTaskFile("spec", "my-repo", "fix-bug");

    expect(task.repo).toBe("my-repo");
  });

  it("defaults repo to empty string", () => {
    const task = parseTaskFile("spec");

    expect(task.repo).toBe("");
  });

  it("defaults id to empty string", () => {
    const task = parseTaskFile("spec");

    expect(task.id).toBe("");
  });

  it("does not include sessionId or archivedAt (those come from sidecar)", () => {
    const task = parseTaskFile("spec", "test-repo", "fix-bug");

    expect(task.sessionId).toBeUndefined();
    expect(task.archivedAt).toBeUndefined();
  });
});

// ── serializeTaskFile ─────────────────────────────────────────────────────────

describe("serializeTaskFile", () => {
  it("returns spec directly", () => {
    const out = serializeTaskFile(FULL_TASK);

    expect(out).toBe("## Goal\n\nBuild the thing.");
  });

  it("returns empty string for empty spec", () => {
    const out = serializeTaskFile(MINIMAL_TASK);

    expect(out).toBe("");
  });

  it("does not include any frontmatter delimiters", () => {
    const out = serializeTaskFile(FULL_TASK);

    expect(out).not.toContain("---");
    expect(out).not.toContain("title:");
  });

  it("does not include sessionId, archivedAt, repo, or status", () => {
    const task: Task = {
      ...FULL_TASK,
      sessionId: "sess-xyz",
      archivedAt: "2026-01-01T00:00:00.000Z",
    };
    const out = serializeTaskFile(task);

    expect(out).not.toContain("sessionId");
    expect(out).not.toContain("archivedAt");
    expect(out).not.toContain("repo:");
    expect(out).not.toContain("status:");
  });
});

// ── round-trip: serialize → parse ────────────────────────────────────────────

describe("round-trip: serialize → parse", () => {
  it("preserves spec for a task with content", () => {
    const serialized = serializeTaskFile(FULL_TASK);
    const parsed = parseTaskFile(serialized, FULL_TASK.repo, FULL_TASK.id);

    expect(parsed.spec).toBe(FULL_TASK.spec);
    expect(parsed.id).toBe(FULL_TASK.id);
    expect(parsed.title).toBe("Implement Feature X");
  });

  it("preserves empty spec", () => {
    const serialized = serializeTaskFile(MINIMAL_TASK);
    const parsed = parseTaskFile(
      serialized,
      MINIMAL_TASK.repo,
      MINIMAL_TASK.id,
    );

    expect(parsed.spec).toBe("");
  });

  it("preserves legacy TASK-NNN id and title", () => {
    const serialized = serializeTaskFile(LEGACY_TASK);
    const parsed = parseTaskFile(serialized, LEGACY_TASK.repo, LEGACY_TASK.id);

    expect(parsed.id).toBe("TASK-042");
    expect(parsed.title).toBe("TASK-042");
  });
});
