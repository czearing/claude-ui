/**
 * @jest-environment node
 */

import { handleHandover, handleRecall } from "./taskHandover";
import { handleTaskRoutes } from "./tasks";
import { broadcastTaskEvent } from "../boardBroadcast";
import {
  deleteTaskFile,
  getUniqueTaskId,
  readAllTasks,
  readTasksForRepo,
  writeTask,
} from "../taskStore";

import { readBody } from "../../utils/readBody";
import type { Task } from "../../utils/tasks.types";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock("../taskStore");
jest.mock("../boardBroadcast");
jest.mock("../../utils/readBody");
// Mock taskHandover so we don't need to wire up PTY spawning in unit tests.
jest.mock("./taskHandover", () => ({
  handleHandover: jest.fn().mockResolvedValue(undefined),
  handleRecall: jest.fn().mockResolvedValue(undefined),
  activePtys: new Map(),
}));

const mockBroadcastTaskEvent = broadcastTaskEvent as jest.MockedFunction<
  typeof broadcastTaskEvent
>;
const mockDeleteTaskFile = deleteTaskFile as jest.MockedFunction<
  typeof deleteTaskFile
>;
const mockGetUniqueTaskId = getUniqueTaskId as jest.MockedFunction<
  typeof getUniqueTaskId
>;
const mockReadAllTasks = readAllTasks as jest.MockedFunction<
  typeof readAllTasks
>;
const mockReadTasksForRepo = readTasksForRepo as jest.MockedFunction<
  typeof readTasksForRepo
>;
const mockWriteTask = writeTask as jest.MockedFunction<typeof writeTask>;
const mockReadBody = readBody as jest.MockedFunction<typeof readBody>;
const mockHandleHandover = handleHandover as jest.MockedFunction<
  typeof handleHandover
>;
const mockHandleRecall = handleRecall as jest.MockedFunction<
  typeof handleRecall
>;

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test-task",
    title: "Test Task",
    status: "Backlog",
    spec: "some spec",
    repo: "test-repo",
    ...overrides,
  };
}

function makeReq(method: string, url: string): IncomingMessage {
  return { method, url, on: jest.fn() } as unknown as IncomingMessage;
}

function makeRes() {
  const res = {
    writeHead: jest.fn().mockReturnThis(),
    write: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  };
  return res as unknown as ServerResponse & {
    writeHead: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
  };
}

function parsedUrl(url: string): ReturnType<typeof parse> {
  return parse(url, true);
}

beforeEach(() => {
  jest.resetAllMocks();
  mockHandleHandover.mockResolvedValue(undefined);
  mockHandleRecall.mockResolvedValue(undefined);
  mockWriteTask.mockResolvedValue(undefined);
  mockBroadcastTaskEvent.mockReturnValue(undefined);
  mockDeleteTaskFile.mockResolvedValue(undefined);
});

// ── GET /api/tasks ─────────────────────────────────────────────────────────────

describe("GET /api/tasks", () => {
  it("returns all tasks when no repo query param", async () => {
    const tasks = [
      makeTask({ id: "fix-bug" }),
      makeTask({ id: "add-feature" }),
    ];
    mockReadAllTasks.mockResolvedValueOnce(tasks);

    const req = makeReq("GET", "/api/tasks");
    const res = makeRes();
    const result = await handleTaskRoutes(req, res, parsedUrl("/api/tasks"));

    expect(result).toBe(true);
    expect(mockReadAllTasks).toHaveBeenCalledTimes(1);
    expect(mockReadTasksForRepo).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(tasks));
  });

  it("returns tasks for a specific repo when repo provided", async () => {
    const tasks = [makeTask({ id: "other-task", repo: "my-repo" })];
    mockReadTasksForRepo.mockResolvedValueOnce(tasks);

    const req = makeReq("GET", "/api/tasks?repo=my-repo");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks?repo=my-repo"),
    );

    expect(result).toBe(true);
    expect(mockReadTasksForRepo).toHaveBeenCalledWith("my-repo");
    expect(mockReadAllTasks).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(tasks));
  });
});

// ── POST /api/tasks ────────────────────────────────────────────────────────────

describe("POST /api/tasks", () => {
  it("creates a task with correct fields, writes, broadcasts, returns 201", async () => {
    mockGetUniqueTaskId.mockResolvedValueOnce("new-task");
    mockReadBody.mockResolvedValueOnce({
      title: "New Task",
      status: "Not Started",
      spec: "the spec",
      repo: "test-repo",
    });

    const req = makeReq("POST", "/api/tasks");
    const res = makeRes();
    const result = await handleTaskRoutes(req, res, parsedUrl("/api/tasks"));

    expect(result).toBe(true);
    expect(mockGetUniqueTaskId).toHaveBeenCalledWith("New Task", "test-repo");
    expect(mockWriteTask).toHaveBeenCalledTimes(1);

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.id).toBe("new-task");
    expect(written.title).toBe("New Task");
    // New tasks are always created as Backlog regardless of body status
    expect(written.status).toBe("Backlog");
    expect(written.spec).toBe("the spec");
    expect(written.repo).toBe("test-repo");

    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:created",
      written,
    );
    expect(res.writeHead).toHaveBeenCalledWith(201, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(written));
  });

  it("uses defaults for missing optional fields", async () => {
    mockGetUniqueTaskId.mockResolvedValueOnce("minimal");
    mockReadBody.mockResolvedValueOnce({ title: "Minimal", repo: "test-repo" });

    const req = makeReq("POST", "/api/tasks");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Backlog");
    expect(written.spec).toBe("");
  });

  it("falls back to empty string for non-string title and 'default' for missing repo", async () => {
    mockGetUniqueTaskId.mockResolvedValueOnce("untitled");
    mockReadBody.mockResolvedValueOnce({ title: 42, status: "Backlog" });

    const req = makeReq("POST", "/api/tasks");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.title).toBe("");
    expect(written.repo).toBe("claude-code-ui");
  });
});

// ── PATCH /api/tasks/:id ───────────────────────────────────────────────────────

describe("PATCH /api/tasks/:id", () => {
  it("returns 404 when task not found", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);
    mockReadBody.mockResolvedValueOnce({ title: "Updated" });

    const req = makeReq("PATCH", "/api/tasks/nonexistent-task");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/nonexistent-task"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(mockWriteTask).not.toHaveBeenCalled();
  });

  it("updates task fields, writes with prevStatus, broadcasts, returns 200", async () => {
    const existing = makeTask({ id: "test-task", status: "Backlog" });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ title: "Updated Title" });

    const req = makeReq("PATCH", "/api/tasks/test-task");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task"),
    );

    expect(result).toBe(true);
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.id).toBe("test-task");
    expect(written.title).toBe("Updated Title");
    expect(written.repo).toBe("test-repo"); // preserved
    // prevStatus is passed as second arg
    expect(mockWriteTask).toHaveBeenCalledWith(written, "Backlog");
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:updated",
      written,
    );
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(written));
  });

  it("sets archivedAt and clears sessionId when status becomes Done", async () => {
    const existing = makeTask({
      id: "test-task",
      status: "In Progress",
      sessionId: "sess-abc",
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ status: "Done" });

    const req = makeReq("PATCH", "/api/tasks/test-task");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/test-task"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Done");
    expect(written.archivedAt).toBeDefined();
    expect(written.sessionId).toBeUndefined();
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
  });

  it("does not overwrite archivedAt when already Done (stamp once)", async () => {
    const existing = makeTask({
      id: "test-task",
      status: "Done",
      archivedAt: "2026-01-10T00:00:00.000Z",
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ status: "Done", title: "Re-done" });

    const req = makeReq("PATCH", "/api/tasks/test-task");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/test-task"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.archivedAt).toBe("2026-01-10T00:00:00.000Z");
  });

  it("clears archivedAt and sessionId when leaving Done", async () => {
    const existing = makeTask({
      id: "test-task",
      status: "Done",
      archivedAt: "2026-01-10T00:00:00.000Z",
      sessionId: "sess-old",
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ status: "Backlog" });

    const req = makeReq("PATCH", "/api/tasks/test-task");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/test-task"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Backlog");
    expect(written.archivedAt).toBeUndefined();
    expect(written.sessionId).toBeUndefined();
  });

  it("sets archivedAt and clears sessionId when becomingDone, no sessionId present", async () => {
    const existing = makeTask({
      id: "test-task",
      status: "In Progress",
      // No sessionId
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ status: "Done" });

    const req = makeReq("PATCH", "/api/tasks/test-task");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/test-task"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Done");
    expect(written.archivedAt).toBeDefined();
    expect(written.sessionId).toBeUndefined();
  });
});

// ── DELETE /api/tasks/:id ──────────────────────────────────────────────────────

describe("DELETE /api/tasks/:id", () => {
  it("deletes task file, broadcasts task:deleted, returns 204", async () => {
    const task = makeTask({
      id: "test-task",
      repo: "test-repo",
      status: "Backlog",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);

    const req = makeReq("DELETE", "/api/tasks/test-task");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task"),
    );

    expect(result).toBe(true);
    expect(mockDeleteTaskFile).toHaveBeenCalledWith(
      "test-task",
      "test-repo",
      "Backlog",
    );
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith("task:deleted", {
      id: "test-task",
      repo: "test-repo",
    });
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("still broadcasts and returns 204 even when task not found", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);

    const req = makeReq("DELETE", "/api/tasks/nonexistent-task");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/nonexistent-task"),
    );

    expect(result).toBe(true);
    expect(mockDeleteTaskFile).not.toHaveBeenCalled();
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith("task:deleted", {
      id: "nonexistent-task",
      repo: undefined,
    });
    expect(res.writeHead).toHaveBeenCalledWith(204);
  });
});

// ── POST /api/tasks/:id/recall ─────────────────────────────────────────────────

describe("POST /api/tasks/:id/recall", () => {
  it("delegates to handleRecall with the task id and returns true", async () => {
    const req = makeReq("POST", "/api/tasks/test-task/recall");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/recall"),
    );

    expect(result).toBe(true);
    expect(mockHandleRecall).toHaveBeenCalledWith(req, res, "test-task");
  });
});

// ── POST /api/tasks/:id/handover ───────────────────────────────────────────────
// The handover route delegates immediately to handleHandover (inline PTY
// spawning). The details of the PTY lifecycle are tested in taskHandover.test.ts.

describe("POST /api/tasks/:id/handover", () => {
  it("delegates to handleHandover with the task id and returns true", async () => {
    const req = makeReq("POST", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
    );

    expect(result).toBe(true);
    expect(mockHandleHandover).toHaveBeenCalledWith(req, res, "test-task");
  });

  it("returns false for PATCH on a handover path", async () => {
    const req = makeReq("PATCH", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
    );

    expect(result).toBe(false);
    expect(mockHandleHandover).not.toHaveBeenCalled();
  });
});

// ── DELETE /api/sessions/:id (proxy) ──────────────────────────────────────────

describe("DELETE /api/sessions/:id", () => {
  it("kills the local PTY if running and returns 204", async () => {
    const req = makeReq("DELETE", "/api/sessions/sess-123");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/sessions/sess-123"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("returns 204 even when no PTY is running for the session", async () => {
    const req = makeReq("DELETE", "/api/sessions/sess-456");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/sessions/sess-456"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(204);
  });
});

// ── Unrecognised route ─────────────────────────────────────────────────────────

describe("unrecognised routes", () => {
  it("returns false for an unrecognised GET path", async () => {
    const req = makeReq("GET", "/api/unknown");
    const res = makeRes();
    const result = await handleTaskRoutes(req, res, parsedUrl("/api/unknown"));

    expect(result).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it("returns false for an unrecognised POST path", async () => {
    const req = makeReq("POST", "/api/other");
    const res = makeRes();
    const result = await handleTaskRoutes(req, res, parsedUrl("/api/other"));

    expect(result).toBe(false);
  });
});
