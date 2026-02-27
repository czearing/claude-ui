/**
 * @jest-environment node
 */

import { handleTaskRoutes } from "./tasks";
import { broadcastTaskEvent } from "../boardBroadcast";
import { readRepos } from "../repoStore";
import {
  deleteTaskFile,
  getUniqueTaskId,
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
const mockExtractTextFromLexical =
  extractTextFromLexical as jest.MockedFunction<typeof extractTextFromLexical>;
const mockReadBody = readBody as jest.MockedFunction<typeof readBody>;
const mockRandomUUID = randomUUID as jest.MockedFunction<typeof randomUUID>;

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

  it("sets archivedAt, clears sessionId, and sends kill when status becomes Done", async () => {
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

  it("does not call kill fetch when becomingDone but task has no sessionId", async () => {
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

    expect(mockFetch).not.toHaveBeenCalled();
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
  it("returns 404 when task not found", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);

    const req = makeReq("POST", "/api/tasks/nonexistent-task/recall");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/nonexistent-task/recall"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(mockWriteTask).not.toHaveBeenCalled();
  });

  it("sets status to Backlog, clears sessionId, kills old session, broadcasts", async () => {
    const existing = makeTask({
      id: "test-task",
      status: "In Progress",
      sessionId: "sess-xyz",
    });
    mockReadAllTasks.mockResolvedValueOnce([existing]);

    const req = makeReq("POST", "/api/tasks/test-task/recall");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/recall"),
    );

    expect(result).toBe(true);
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Backlog");
    expect(written.sessionId).toBeUndefined();
    // prevStatus passed
    expect(mockWriteTask).toHaveBeenCalledWith(written, "In Progress");

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
    const existing = makeTask({ id: "test-task", status: "Review" });
    mockReadAllTasks.mockResolvedValueOnce([existing]);

    const req = makeReq("POST", "/api/tasks/test-task/recall");
    const res = makeRes();
    await handleTaskRoutes(req, res, parsedUrl("/api/tasks/test-task/recall"));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── POST /api/tasks/:id/handover ───────────────────────────────────────────────

describe("POST /api/tasks/:id/handover", () => {
  it("returns 404 when task not found", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);

    const req = makeReq("POST", "/api/tasks/nonexistent-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/nonexistent-task/handover"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(mockWriteTask).not.toHaveBeenCalled();
  });

  it("advances directly to Review when spec is empty", async () => {
    const task = makeTask({ id: "test-task", title: "", spec: "" });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("   "); // whitespace only

    const req = makeReq("POST", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
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
    const task = makeTask({ id: "test-task", spec: "do the thing" });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("do the thing");
    mockReadRepos.mockResolvedValueOnce([]);
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const req = makeReq("POST", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
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
    const task = makeTask({ id: "test-task", spec: "do work" });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("do work");
    mockReadRepos.mockResolvedValueOnce([]);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      text: jest.fn().mockResolvedValueOnce("internal pty error"),
    } as unknown as Response);

    const req = makeReq("POST", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
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
      id: "test-task",
      spec: "implement feature",
      repo: "test-repo",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("implement feature");
    mockRandomUUID.mockReturnValueOnce(
      "550e8400-e29b-41d4-a716-446655440000" as ReturnType<typeof randomUUID>,
    );
    mockReadRepos.mockResolvedValueOnce([
      {
        id: "repo-abc",
        name: "test-repo",
        path: "/repos/my-repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const req = makeReq("POST", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
    );

    expect(result).toBe(true);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sessions"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
    const fetchBody = JSON.parse(fetchCall[1].body as string) as {
      sessionId: string;
      spec: string;
      cwd: string;
    };
    expect(fetchBody.sessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(fetchBody.cwd).toBe("/repos/my-repo");
    // Spec is the raw task spec text — no file-move instructions appended
    // (task completion is now signalled via the Claude Code Stop hook)
    expect(fetchBody.spec).not.toContain("mv ");
    expect(fetchBody.spec).not.toContain("TASK FILE");

    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("In Progress");
    expect(written.sessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
    // prevStatus is passed
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

  it("falls back to process.cwd() when repo not found", async () => {
    const task = makeTask({
      id: "test-task",
      spec: "work",
      repo: "missing-repo",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("work");
    mockRandomUUID.mockReturnValueOnce(
      "aaaabbbb-cccc-dddd-eeee-ffffffffffff" as ReturnType<typeof randomUUID>,
    );
    mockReadRepos.mockResolvedValueOnce([]); // no matching repo
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const req = makeReq("POST", "/api/tasks/test-task/handover");
    const res = makeRes();
    await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
    );

    const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
    const fetchBody = JSON.parse(fetchCall[1].body as string) as {
      cwd: string;
    };
    expect(fetchBody.cwd).toBe(process.cwd());
  });

  it("advances directly to Review when spec body is whitespace-only", async () => {
    const task = makeTask({ id: "test-task", title: "My Task", spec: "   " });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("   "); // whitespace only

    const req = makeReq("POST", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
    );

    expect(result).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("Review");
  });

  it("spec-only path: empty title is excluded so spec sent is just the spec text plus instructions", async () => {
    const task = makeTask({
      id: "test-task",
      title: "",
      spec: "some spec text",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("do the thing");
    mockRandomUUID.mockReturnValueOnce(
      "550e8400-e29b-41d4-a716-446655440000" as ReturnType<typeof randomUUID>,
    );
    mockReadRepos.mockResolvedValueOnce([
      {
        id: "repo-abc",
        name: "test-repo",
        path: "/repos/my-repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const req = makeReq("POST", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
    );

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
    const fetchBody = JSON.parse(fetchCall[1].body as string) as {
      spec: string;
    };
    // Spec is raw task spec text with no file-move instructions
    expect(fetchBody.spec).not.toContain("mv ");
    expect(fetchBody.spec).not.toContain("TASK FILE");
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("In Progress");
  });

  it('null spec latent bug: real extractTextFromLexical returns the string "null" when spec is null', async () => {
    const task = makeTask({
      id: "test-task",
      title: "My Task",
      spec: null as unknown as string,
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);
    mockExtractTextFromLexical.mockReturnValueOnce("null");
    mockRandomUUID.mockReturnValueOnce(
      "550e8400-e29b-41d4-a716-446655440000" as ReturnType<typeof randomUUID>,
    );
    mockReadRepos.mockResolvedValueOnce([
      {
        id: "repo-abc",
        name: "test-repo",
        path: "/repos/my-repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);

    const req = makeReq("POST", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
    );

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0] as [string, RequestInit];
    const fetchBody = JSON.parse(fetchCall[1].body as string) as {
      spec: string;
    };
    expect(fetchBody.spec).not.toContain("mv ");
    expect(fetchBody.spec).not.toContain("TASK FILE");
  });
});

// ── POST /api/internal/sessions/:id/advance-to-review ─────────────────────────

describe("POST /api/internal/sessions/:id/advance-to-review", () => {
  it("advances an In Progress task matching the sessionId to Review", async () => {
    const task = makeTask({
      id: "test-task",
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
    // prevStatus passed
    expect(mockWriteTask).toHaveBeenCalledWith(written, "In Progress");
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:updated",
      written,
    );
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("does nothing (no write/broadcast) when task is not In Progress", async () => {
    const task = makeTask({
      id: "test-task",
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

// ── POST /api/internal/sessions/:id/back-to-in-progress ───────────────────────

describe("POST /api/internal/sessions/:id/back-to-in-progress", () => {
  it("transitions a Review task matching sessionId back to In Progress, preserves sessionId, broadcasts", async () => {
    const task = makeTask({
      id: "test-task",
      status: "Review",
      sessionId: "sess-abc",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);

    const req = makeReq(
      "POST",
      "/api/internal/sessions/sess-abc/back-to-in-progress",
    );
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/internal/sessions/sess-abc/back-to-in-progress"),
    );

    expect(result).toBe(true);
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("In Progress");
    expect(written.sessionId).toBe("sess-abc");
    // prevStatus passed
    expect(mockWriteTask).toHaveBeenCalledWith(written, "Review");
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:updated",
      written,
    );
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("does nothing (no write/broadcast) when task is already In Progress", async () => {
    const task = makeTask({
      id: "test-task",
      status: "In Progress",
      sessionId: "sess-abc",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);

    const req = makeReq(
      "POST",
      "/api/internal/sessions/sess-abc/back-to-in-progress",
    );
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/internal/sessions/sess-abc/back-to-in-progress"),
    );

    expect(result).toBe(true);
    expect(mockWriteTask).not.toHaveBeenCalled();
    expect(mockBroadcastTaskEvent).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(204);
  });

  it("does nothing when task is in Backlog (not Review)", async () => {
    const task = makeTask({
      id: "test-task",
      status: "Backlog",
      sessionId: "sess-abc",
    });
    mockReadAllTasks.mockResolvedValueOnce([task]);

    const req = makeReq(
      "POST",
      "/api/internal/sessions/sess-abc/back-to-in-progress",
    );
    const res = makeRes();
    await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/internal/sessions/sess-abc/back-to-in-progress"),
    );

    expect(mockWriteTask).not.toHaveBeenCalled();
    expect(mockBroadcastTaskEvent).not.toHaveBeenCalled();
  });

  it("returns 204 when no task matches the sessionId", async () => {
    mockReadAllTasks.mockResolvedValueOnce([]);

    const req = makeReq(
      "POST",
      "/api/internal/sessions/unknown-sess/back-to-in-progress",
    );
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/internal/sessions/unknown-sess/back-to-in-progress"),
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
    const req = makeReq("PATCH", "/api/tasks/test-task/handover");
    const res = makeRes();
    const result = await handleTaskRoutes(
      req,
      res,
      parsedUrl("/api/tasks/test-task/handover"),
    );

    expect(result).toBe(false);
  });
});
