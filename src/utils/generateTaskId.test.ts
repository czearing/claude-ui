import type { Task } from "./tasks.types";
import { generateTaskId } from "./generateTaskId";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTask(id: string): Task {
  return {
    id,
    title: "stub",
    status: "Backlog",
    priority: "Medium",
    spec: "",
    repoId: "r",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ── generateTaskId ────────────────────────────────────────────────────────────

describe("generateTaskId", () => {
  it("returns TASK-001 for an empty list", () => {
    expect(generateTaskId([])).toBe("TASK-001");
  });

  it("returns TASK-002 when the only task is TASK-001", () => {
    expect(generateTaskId([makeTask("TASK-001")])).toBe("TASK-002");
  });

  it("returns max + 1 from a list with non-sequential IDs", () => {
    const tasks = [
      makeTask("TASK-001"),
      makeTask("TASK-005"),
      makeTask("TASK-003"),
    ];
    expect(generateTaskId(tasks)).toBe("TASK-006");
  });

  it("zero-pads single-digit IDs to three characters", () => {
    expect(generateTaskId([makeTask("TASK-009")])).toBe("TASK-010");
  });

  it("handles IDs beyond 100", () => {
    expect(generateTaskId([makeTask("TASK-099")])).toBe("TASK-100");
    expect(generateTaskId([makeTask("TASK-100")])).toBe("TASK-101");
  });

  it("ignores tasks whose IDs are not TASK-NNN format", () => {
    const tasks = [
      makeTask("custom-id"),
      makeTask("not-a-task"),
      makeTask("TASK-003"),
    ];
    // Only TASK-003 contributes; max = 3, next = 4
    expect(generateTaskId(tasks)).toBe("TASK-004");
  });

  it("ignores tasks with no numeric suffix after stripping TASK-", () => {
    const tasks = [
      makeTask("TASK-"),
      makeTask("TASK-abc"),
      makeTask("TASK-002"),
    ];
    expect(generateTaskId(tasks)).toBe("TASK-003");
  });
});
