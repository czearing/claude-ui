/**
 * @jest-environment node
 */
import { handleRepoRoutes } from "./repos";
import { broadcastTaskEvent } from "../boardBroadcast";
import { readRepos, writeRepos } from "../repoStore";

import { readBody } from "../../utils/readBody";
import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { parse } from "node:url";

jest.mock("../repoStore");
jest.mock("../boardBroadcast");
jest.mock("../../utils/readBody");
jest.mock("node:fs");

const mockReadRepos = readRepos as jest.MockedFunction<typeof readRepos>;
const mockWriteRepos = writeRepos as jest.MockedFunction<typeof writeRepos>;
const mockBroadcastTaskEvent = broadcastTaskEvent as jest.MockedFunction<
  typeof broadcastTaskEvent
>;
const mockReadBody = readBody as jest.MockedFunction<typeof readBody>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

// ── helpers ───────────────────────────────────────────────────────────────────

type MockRes = {
  writeHead: jest.Mock;
  end: jest.Mock;
};

function makeRes(): MockRes {
  return {
    writeHead: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  };
}

function makeReq(method: string): IncomingMessage {
  return { method } as IncomingMessage;
}

// ── GET /api/repos ────────────────────────────────────────────────────────────

describe("GET /api/repos", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns repos list with 200", async () => {
    const repos = [
      {
        id: "abc-123",
        name: "My Repo",
        path: "/home/user/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockReadRepos.mockResolvedValueOnce(repos);

    const req = makeReq("GET");
    const res = makeRes();
    const parsed = parse("/api/repos");

    const handled = await handleRepoRoutes(
      req,
      res as never,
      parsed,
    );

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(repos));
  });
});

// ── POST /api/repos ───────────────────────────────────────────────────────────

describe("POST /api/repos", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 400 when name is missing", async () => {
    mockReadBody.mockResolvedValueOnce({ path: "/some/path" });

    const req = makeReq("POST");
    const res = makeRes();
    const parsed = parse("/api/repos");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "name and path are required" }),
    );
  });

  it("returns 400 when path is missing", async () => {
    mockReadBody.mockResolvedValueOnce({ name: "My Repo" });

    const req = makeReq("POST");
    const res = makeRes();
    const parsed = parse("/api/repos");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "name and path are required" }),
    );
  });

  it("returns 400 when path does not exist on disk", async () => {
    mockReadBody.mockResolvedValueOnce({
      name: "My Repo",
      path: "/nonexistent/path",
    });
    mockExistsSync.mockReturnValueOnce(false);

    const req = makeReq("POST");
    const res = makeRes();
    const parsed = parse("/api/repos");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Path does not exist: /nonexistent/path" }),
    );
  });

  it("creates repo, writes, broadcasts repo:created, returns 201", async () => {
    const existingRepos = [
      {
        id: "existing-1",
        name: "Existing",
        path: "/existing",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockReadBody.mockResolvedValueOnce({
      name: "  New Repo  ",
      path: "/valid/path",
    });
    mockExistsSync.mockReturnValueOnce(true);
    mockReadRepos.mockResolvedValueOnce(existingRepos);
    mockWriteRepos.mockResolvedValueOnce(undefined);

    const req = makeReq("POST");
    const res = makeRes();
    const parsed = parse("/api/repos");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(true);
    expect(mockWriteRepos).toHaveBeenCalledTimes(1);

    const writtenRepos = mockWriteRepos.mock.calls[0][0];
    expect(writtenRepos).toHaveLength(2);
    const newRepo = writtenRepos[1];
    expect(newRepo.name).toBe("New Repo");
    expect(newRepo.path).toBe("/valid/path");
    expect(typeof newRepo.id).toBe("string");
    expect(typeof newRepo.createdAt).toBe("string");

    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "repo:created",
      newRepo,
    );

    expect(res.writeHead).toHaveBeenCalledWith(201, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(newRepo));
  });
});

// ── PATCH /api/repos/:id ──────────────────────────────────────────────────────

describe("PATCH /api/repos/:id", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns 404 when repo not found", async () => {
    mockReadBody.mockResolvedValueOnce({ name: "Updated Name" });
    mockReadRepos.mockResolvedValueOnce([]);

    const req = makeReq("PATCH");
    const res = makeRes();
    const parsed = parse("/api/repos/unknown-id");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
  });

  it("returns 400 when new path does not exist", async () => {
    const repos = [
      {
        id: "repo-1",
        name: "My Repo",
        path: "/old/path",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockReadBody.mockResolvedValueOnce({ path: "/bad/path" });
    mockReadRepos.mockResolvedValueOnce(repos);
    mockExistsSync.mockReturnValueOnce(false);

    const req = makeReq("PATCH");
    const res = makeRes();
    const parsed = parse("/api/repos/repo-1");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Path does not exist: /bad/path" }),
    );
  });

  it("updates repo and returns 200 with updated data", async () => {
    const repos = [
      {
        id: "repo-1",
        name: "Old Name",
        path: "/old/path",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    mockReadBody.mockResolvedValueOnce({ name: "New Name", path: "/new/path" });
    mockReadRepos.mockResolvedValueOnce(repos);
    mockExistsSync.mockReturnValueOnce(true);
    mockWriteRepos.mockResolvedValueOnce(undefined);

    const req = makeReq("PATCH");
    const res = makeRes();
    const parsed = parse("/api/repos/repo-1");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(true);
    expect(mockWriteRepos).toHaveBeenCalledTimes(1);

    const updatedRepo = mockWriteRepos.mock.calls[0][0][0];
    expect(updatedRepo.id).toBe("repo-1");
    expect(updatedRepo.name).toBe("New Name");
    expect(updatedRepo.path).toBe("/new/path");

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(updatedRepo));
  });
});

// ── DELETE /api/repos/:id ─────────────────────────────────────────────────────

describe("DELETE /api/repos/:id", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("removes repo, writes, broadcasts repo:deleted, returns 204", async () => {
    const repos = [
      {
        id: "repo-1",
        name: "Repo One",
        path: "/path/one",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "repo-2",
        name: "Repo Two",
        path: "/path/two",
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ];
    mockReadRepos.mockResolvedValueOnce(repos);
    mockWriteRepos.mockResolvedValueOnce(undefined);

    const req = makeReq("DELETE");
    const res = makeRes();
    const parsed = parse("/api/repos/repo-1");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(true);
    expect(mockWriteRepos).toHaveBeenCalledWith([repos[1]]);
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith("repo:deleted", {
      id: "repo-1",
    });
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});

// ── non-matching routes ───────────────────────────────────────────────────────

describe("non-matching routes", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns false for a completely unrelated route", async () => {
    const req = makeReq("GET");
    const res = makeRes();
    const parsed = parse("/api/tasks");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("returns false for an unknown HTTP method on /api/repos", async () => {
    const req = makeReq("PUT");
    const res = makeRes();
    const parsed = parse("/api/repos");

    const handled = await handleRepoRoutes(req, res as never, parsed);

    expect(handled).toBe(false);
  });
});
