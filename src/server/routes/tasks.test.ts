/**
 * @jest-environment node
 */

import { handleTaskRoutes } from "./tasks";
import { broadcastTaskEvent } from "../boardBroadcast";
import { readRepos } from "../repoStore";
import {
  deleteTaskFile,
  getNextTaskId,
  readAllTasks,
  readTasksForRepo,
  writeTask,
} from "../taskStore";

import { extractTextFromLexical } from "../../utils/lexical";
import { readBody } from "../../utils/readBody";
import type { Task } from "../../utils/tasks.types";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parse } from "node:url";

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock("../taskStore");
jest.mock("../boardBroadcast");
jest.mock("../repoStore");
jest.mock("../../utils/lexical");
jest.mock("../../utils/readBody");
jest.mock("node:crypto");

const mockBroadcastTaskEvent = broadcastTaskEvent as jest.MockedFunction<
  typeof broadcastTaskEvent
>;
const mockReadRepos = readRepos as jest.MockedFunction<typeof readRepos>;
const mockDeleteTaskFile = deleteTaskFile as jest.MockedFunction<
  typeof deleteTaskFile
>;
const mockGetNextTaskId = getNextTaskId as jest.MockedFunction<
  typeof getNextTaskId
>;
const mockReadAllTasks = readAllTasks as jest.MockedFunction<
  typeof readAllTasks
>;
const mockReadTasksForRepo = readTasksForRepo as jest.MockedFunction<
  typeof readTasksForRepo
>;
const mockWriteTask = writeTask as jest.MockedFunction<typeof writeTask>;
const mockExtractTextFromLexical =
  extractTextFromLexical as jest.MockedFunction<typeof extractTextFromLexical>;
const mockReadBody = readBody as jest.MockedFunction<typeof readBody>;
const mockRandomUUID = randomUUID as jest.MockedFunction<typeof randomUUID>;

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-001",
    title: "Test Task",
    status: "Backlog",
    priority: "Medium",
    spec: "some spec",
    repoId: "repo-abc",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function makeReq(method: string, url: string): IncomingMessage {
  return { method, url } as unknown as IncomingMessage;
}

function makeRes() {
  const res = {
    writeHead: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  };
  return res as unknown as ServerResponse & {
    writeHead: jest.Mock;
    end: jest.Mock;
  };
}

function parsedUrl(url: string): ReturnType<typeof parse> {
  return parse(url, true);
}

// Capture and replace global fetch so pty-manager HTTP calls can be controlled.
let mockFetch: jest.Mock;

beforeAll(() => {
  mockFetch = jest.fn();
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  jest.resetAllMocks();
  // Provide sensible defaults so tests that don't care about fetch don't throw.
  mockFetch.mockResolvedValue({ ok: true } as Response);
  mockWriteTask.mockResolvedValue(undefined);
  mockBroadcastTaskEvent.mockReturnValue(undefined);
  mockDeleteTaskFile.mockResolvedValue(undefined);
});

// ── GET /api/tasks ─────────────────────────────────────────────────────────────

describe("GET /api/tasks", () => {
  it("returns all tasks when no repoId query param", async () => {
    const tasks = [makeTask({ id: "TASK-001" }), makeTask({ id: "TASK-002" })];
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

  it("returns tasks for a specific repo when repoId provided", async () => {
    const tasks = [makeTask({ id: "TASK-003", repoId: "repo-xyz" })];
    mockReadTasksForRepo.mockResolvedValueOnce(tasks);

    const req = makeReq("GET", "/api/tasks?repoId=repo-xyz");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks?repoId=repo-xyz"),
    );

    expect(result).toBe(true);
    expect(mockReadTasksForRepo).toHaveBeenCalledWith("repo-xyz");
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
    mockGetNextTaskId.mockResolvedValueOnce("TASK-005");
    mockReadBody.mockResolvedValueOnce({
      title: "New Task",
      status: "Not Started",
      priority: "High",
      spec: "the spec",
      repoId: "repo-abc",
    });

    const req = makeReq("POST", "/api/tasks");
    const res = makeRes();
    const result = await handleTaskRoutes(req, res, parsedUrl("/api/tasks"));

    expect(result).toBe(true);
    expect(mockWriteTask).toHaveBeenCalledTimes(1);

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.id).toBe("TASK-005");
    expect(written.title).toBe("New Task");
    expect(written.status).toBe("Not Started");
    expect(written.priority).toBe("High");
    expect(written.spec).toBe("the spec");
    expect(written.repoId).toBe("repo-abc");
    expect(typeof written.createdAt).toBe("string");
    expect(typeof written.updatedAt).toBe("string");

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
    mockGetNextTaskId.mockResolvedValueOnce("TASK-006");
    mockReadBody.mockResolvedValueOnce({ title: "Minimal", repoId: "repo-1" });

    const req = makeReq("POST", "/api/tasks");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Backlog");
    expect(written.priority).toBe("Medium");
    expect(written.spec).toBe("");
  });

  it("falls back to empty string for non-string title and 'default' for missing repoId", async () => {
    mockGetNextTaskId.mockResolvedValueOnce("TASK-007");
    mockReadBody.mockResolvedValueOnce({ title: 42, status: "Backlog" });

    const req = makeReq("POST", "/api/tasks");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.title).toBe("");
    expect(written.repoId).toBe("default");
  });
});

// ── PATCH /api/tasks/:id ───────────────────────────────────────────────────────

describe("PATCH /api/tasks/:id", () => {
  it("returns 404 when task not found", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);
    mockReadBody.mockResolvedValueOnce({ title: "Updated" });

    const req = makeReq("PATCH", "/api/tasks/TASK-999");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-999"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(mockWriteTask).not.toHaveBeenCalled();
  });

  it("updates task fields, writes, broadcasts, returns 200", async () => {
    const existing = makeTask({ id: "TASK-001", status: "Backlog" });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ title: "Updated Title" });

    const req = makeReq("PATCH", "/api/tasks/TASK-001");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-001"),
    );

    expect(result).toBe(true);
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.id).toBe("TASK-001");
    expect(written.title).toBe("Updated Title");
    expect(written.repoId).toBe("repo-abc"); // preserved
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:updated",
      written,
    );
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(written));
  });

  it("sets archivedAt, clears sessionId, and sends kill when status becomes Done", async () => {
    const existing = makeTask({
      id: "TASK-001",
      status: "In Progress",
      sessionId: "sess-abc",
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ status: "Done" });

    const req = makeReq("PATCH", "/api/tasks/TASK-001");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/TASK-001"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Done");
    expect(written.archivedAt).toBeDefined();
    expect(written.sessionId).toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/sess-abc/kill"),
      { method: "POST" },
    );
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
  });

  it("does not overwrite archivedAt when already Done (stamp once)", async () => {
    const existing = makeTask({
      id: "TASK-001",
      status: "Done",
      archivedAt: "2026-01-10T00:00:00.000Z",
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ status: "Done", title: "Re-done" });

    const req = makeReq("PATCH", "/api/tasks/TASK-001");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/TASK-001"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.archivedAt).toBe("2026-01-10T00:00:00.000Z");
  });

  it("clears archivedAt and sessionId when leaving Done", async () => {
    const existing = makeTask({
      id: "TASK-001",
      status: "Done",
      archivedAt: "2026-01-10T00:00:00.000Z",
      sessionId: "sess-old",
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ status: "Backlog" });

    const req = makeReq("PATCH", "/api/tasks/TASK-001");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/TASK-001"));

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Backlog");
    expect(written.archivedAt).toBeUndefined();
    expect(written.sessionId).toBeUndefined();
  });

  it("does not call kill fetch when becomingDone but task has no sessionId", async () => {
    const existing = makeTask({
      id: "TASK-001",
      status: "In Progress",
      // No sessionId
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);
    mockReadBody.mockResolvedValueOnce({ status: "Done" });

    const req = makeReq("PATCH", "/api/tasks/TASK-001");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/TASK-001"));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── DELETE /api/tasks/:id ──────────────────────────────────────────────────────

describe("DELETE /api/tasks/:id", () => {
  it("deletes task file, broadcasts task:deleted, returns 204", async () => {
    const task = makeTask({ id: "TASK-001", repoId: "repo-abc" });
    mockReadAllTasks.mockResolvedValueOnce([task]);

    const req = makeReq("DELETE", "/api/tasks/TASK-001");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-001"),
    );

    expect(result).toBe(true);
    expect(mockDeleteTaskFile).toHaveBeenCalledWith("TASK-001", "repo-abc");
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith("task:deleted", {
      id: "TASK-001",
      repoId: "repo-abc",
    });
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("still broadcasts and returns 204 even when task not found", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);

    const req = makeReq("DELETE", "/api/tasks/TASK-999");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-999"),
    );

    expect(result).toBe(true);
    expect(mockDeleteTaskFile).not.toHaveBeenCalled();
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith("task:deleted", {
      id: "TASK-999",
      repoId: undefined,
    });
    expect(res.writeHead).toHaveBeenCalledWith(204);
  });
});

// ── POST /api/tasks/:id/recall ─────────────────────────────────────────────────

describe("POST /api/tasks/:id/recall", () => {
  it("returns 404 when task not found", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);

    const req = makeReq("POST", "/api/tasks/TASK-999/recall");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-999/recall"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(mockWriteTask).not.toHaveBeenCalled();
  });

  it("sets status to Backlog, clears sessionId, kills old session, broadcasts", async () => {
    const existing = makeTask({
      id: "TASK-001",
      status: "In Progress",
      sessionId: "sess-xyz",
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);

    const req = makeReq("POST", "/api/tasks/TASK-001/recall");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-001/recall"),
    );

    expect(result).toBe(true);
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Backlog");
    expect(written.sessionId).toBeUndefined();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/sess-xyz/kill"),
      { method: "POST" },
    );
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:updated",
      written,
    );
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(written));
  });

  it("does not call kill fetch when task has no sessionId", async () => {
    const existing = makeTask({ id: "TASK-001", status: "Review" });
    mockReadAllTasks.mockResolvedValueOnce([existing]);

    const req = makeReq("POST", "/api/tasks/TASK-001/recall");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/TASK-001/recall"));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── POST /api/tasks/:id/handover ───────────────────────────────────────────────

describe("POST /api/tasks/:id/handover", () => {
  it("returns 404 when task not found", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);

    const req = makeReq("POST", "/api/tasks/TASK-999/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-999/handover"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(mockWriteTask).not.toHaveBeenCalled();
  });

  it("advances directly to Review when spec is empty", async () => {
    const task = makeTask({ id: "TASK-001", spec: "" });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("   "); // whitespace only

    const req = makeReq("POST", "/api/tasks/TASK-001/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-001/handover"),
    );

    expect(result).toBe(true);
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Review");
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:updated",
      written,
    );
    // PTY-manager must NOT be called
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
  });

  it("returns 500 when pty-manager is unreachable", async () => {
    const task = makeTask({ id: "TASK-001", spec: "do the thing" });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("do the thing");
    mockReadRepos.mockResolvedValueOnce([]);
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const req = makeReq("POST", "/api/tasks/TASK-001/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-001/handover"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(500, {
      "Content-Type": "application/json",
    });
    const body = JSON.parse(res.end.mock.calls[0][0] as string) as {
      error: string;
    };
    expect(body.error).toContain("Failed to reach pty-manager");
    expect(mockWriteTask).not.toHaveBeenCalled();
  });

  it("returns 502 when pty-manager returns an error response", async () => {
    const task = makeTask({ id: "TASK-001", spec: "do work" });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("do work");
    mockReadRepos.mockResolvedValueOnce([]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: jest.fn().mockResolvedValueOnce("internal pty error"),
    } as unknown as Response);

    const req = makeReq("POST", "/api/tasks/TASK-001/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-001/handover"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(502, {
      "Content-Type": "application/json",
    });
    const body = JSON.parse(res.end.mock.calls[0][0] as string) as {
      error: string;
    };
    expect(body.error).toBe("internal pty error");
    expect(mockWriteTask).not.toHaveBeenCalled();
  });

  it("sets task to In Progress with sessionId on success", async () => {
    const task = makeTask({
      id: "TASK-001",
      spec: "implement feature",
      repoId: "repo-abc",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("implement feature");
    mockRandomUUID.mockReturnValueOnce(
      "550e8400-e29b-41d4-a716-446655440000" as ReturnType<typeof randomUUID>,
    );
    mockReadRepos.mockResolvedValueOnce([
      {
        id: "repo-abc",
        name: "My Repo",
        path: "/repos/my-repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const req = makeReq("POST", "/api/tasks/TASK-001/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-001/handover"),
    );

    expect(result).toBe(true);

    // Verify pty-manager was called with the right payload
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sessions"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "550e8400-e29b-41d4-a716-446655440000",
          spec: "implement feature",
          cwd: "/repos/my-repo",
        }),
      }),
    );

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("In Progress");
    expect(written.sessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:updated",
      written,
    );
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(written));
  });

  it("falls back to process.cwd() when repo not found", async () => {
    const task = makeTask({
      id: "TASK-001",
      spec: "work",
      repoId: "missing-repo",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("work");
    mockRandomUUID.mockReturnValueOnce(
      "aaaabbbb-cccc-dddd-eeee-ffffffffffff" as ReturnType<typeof randomUUID>,
    );
    mockReadRepos.mockResolvedValueOnce([]); // no matching repo
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const req = makeReq("POST", "/api/tasks/TASK-001/handover");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/TASK-001/handover"));

    const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
    const fetchBody = JSON.parse(fetchCall[1].body as string) as {
      cwd: string;
    };
    expect(fetchBody.cwd).toBe(process.cwd());
  });
});

// ── POST /api/internal/sessions/:id/advance-to-review ─────────────────────────

describe("POST /api/internal/sessions/:id/advance-to-review", () => {
  it("advances an In Progress task matching the sessionId to Review", async () => {
    const task = makeTask({
      id: "TASK-001",
      status: "In Progress",
      sessionId: "sess-abc",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);

    const req = makeReq(
      "POST",
      "/api/internal/sessions/sess-abc/advance-to-review",
    );
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/internal/sessions/sess-abc/advance-to-review"),
    );

    expect(result).toBe(true);
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Review");
    expect(written.sessionId).toBe("sess-abc");
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:updated",
      written,
    );
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("does nothing (no write/broadcast) when task is not In Progress", async () => {
    const task = makeTask({
      id: "TASK-001",
      status: "Review",
      sessionId: "sess-abc",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);

    const req = makeReq(
      "POST",
      "/api/internal/sessions/sess-abc/advance-to-review",
    );
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/internal/sessions/sess-abc/advance-to-review"),
    );

    expect(result).toBe(true);
    expect(mockWriteTask).not.toHaveBeenCalled();
    expect(mockBroadcastTaskEvent).not.toHaveBeenCalled();
    // Still returns 204
    expect(res.writeHead).toHaveBeenCalledWith(204);
  });

  it("returns 204 when no task matches the sessionId", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);

    const req = makeReq(
      "POST",
      "/api/internal/sessions/unknown-sess/advance-to-review",
    );
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/internal/sessions/unknown-sess/advance-to-review"),
    );

    expect(result).toBe(true);
    expect(mockWriteTask).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(204);
  });
});

// ── DELETE /api/sessions/:id (proxy) ──────────────────────────────────────────

describe("DELETE /api/sessions/:id", () => {
  it("proxies the delete to pty-manager and returns 204", async () => {
    const req = makeReq("DELETE", "/api/sessions/sess-123");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/sessions/sess-123"),
    );

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sessions/sess-123"),
      { method: "DELETE" },
    );
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("still returns 204 even when pty-manager fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

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

  it("returns false for a PATCH on /api/tasks/:id/handover (ends with /handover)", async () => {
    const req = makeReq("PATCH", "/api/tasks/TASK-001/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/TASK-001/handover"),
    );

    // PATCH + /handover suffix is excluded from the PATCH handler and doesn't
    // match any other handler, so the function returns false.
    expect(result).toBe(false);
  });
});
