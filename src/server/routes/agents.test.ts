/**
 * @jest-environment node
 */
import { handleAgentRoutes } from "./agents";
import {
  deleteAgent,
  listAgents,
  readAgent,
  resolveAgentsDir,
  writeAgent,
} from "../agentStore";

import { readBody } from "../../utils/readBody";
import type { IncomingMessage, ServerResponse } from "node:http";

jest.mock("../agentStore", () => ({
  AGENT_NAME_RE: /^[a-z0-9-]{1,64}$/,
  resolveAgentsDir: jest.fn(),
  listAgents: jest.fn(),
  readAgent: jest.fn(),
  writeAgent: jest.fn(),
  deleteAgent: jest.fn(),
}));

jest.mock("../../utils/readBody", () => ({
  readBody: jest.fn(),
}));

const mockResolveAgentsDir = resolveAgentsDir as jest.MockedFunction<
  typeof resolveAgentsDir
>;
const mockListAgents = listAgents as jest.MockedFunction<typeof listAgents>;
const mockReadAgent = readAgent as jest.MockedFunction<typeof readAgent>;
const mockWriteAgent = writeAgent as jest.MockedFunction<typeof writeAgent>;
const mockDeleteAgent = deleteAgent as jest.MockedFunction<typeof deleteAgent>;
const mockReadBody = readBody as jest.MockedFunction<typeof readBody>;

interface MockRes {
  writeHead: jest.Mock;
  end: jest.Mock;
}

function makeReq(method: string): IncomingMessage {
  return { method } as unknown as IncomingMessage;
}

function makeRes(): MockRes & ServerResponse {
  return {
    writeHead: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  } as unknown as MockRes & ServerResponse;
}

function parsedUrl(url: string): URL {
  return new URL(url, "http://localhost");
}

const FAKE_DIR = "/home/user/.claude/agents";

beforeEach(() => {
  jest.resetAllMocks();
  mockResolveAgentsDir.mockResolvedValue(FAKE_DIR);
});

// ── GET /api/agents ───────────────────────────────────────────────────────────

describe("GET /api/agents", () => {
  it("lists agents with scope=global by default", async () => {
    const agents = [{ name: "my-agent", description: "Does stuff" }];
    mockListAgents.mockResolvedValue(agents);

    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleAgentRoutes(req, res, parsedUrl("/api/agents"));

    expect(result).toBe(true);
    expect(mockResolveAgentsDir).toHaveBeenCalledWith("global", null);
    expect(mockListAgents).toHaveBeenCalledWith(FAKE_DIR);
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ agents }));
  });

  it("lists agents with scope=repo when query param provided", async () => {
    const agents = [{ name: "repo-agent", description: "Repo-scoped" }];
    mockListAgents.mockResolvedValue(agents);

    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents?scope=repo&repoId=repo-1"),
    );

    expect(result).toBe(true);
    expect(mockResolveAgentsDir).toHaveBeenCalledWith("repo", "repo-1");
    expect(mockListAgents).toHaveBeenCalledWith(FAKE_DIR);
  });

  it("returns 200 with JSON body", async () => {
    mockListAgents.mockResolvedValue([]);

    const req = makeReq("GET");
    const res = makeRes();
    await handleAgentRoutes(req, res, parsedUrl("/api/agents"));

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ agents: [] }));
  });
});

// ── GET /api/agents/:name ─────────────────────────────────────────────────────

describe("GET /api/agents/:name", () => {
  it("returns 400 for an invalid name", async () => {
    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents/bad name with spaces"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Invalid agent name" }),
    );
    expect(mockReadAgent).not.toHaveBeenCalled();
  });

  it("returns 404 when agent is not found", async () => {
    mockReadAgent.mockResolvedValue(null);

    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents/missing-agent"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
  });

  it("returns 200 with agent data when found", async () => {
    const agent = {
      name: "my-agent",
      description: "Does stuff",
      content: "body",
    };
    mockReadAgent.mockResolvedValue(agent);

    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents/my-agent"),
    );

    expect(result).toBe(true);
    expect(mockReadAgent).toHaveBeenCalledWith(FAKE_DIR, "my-agent");
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(agent));
  });
});

// ── POST /api/agents ──────────────────────────────────────────────────────────

describe("POST /api/agents", () => {
  it("returns 400 for an invalid name", async () => {
    mockReadBody.mockResolvedValue({ name: "INVALID NAME!", content: "" });

    const req = makeReq("POST");
    const res = makeRes();
    const result = await handleAgentRoutes(req, res, parsedUrl("/api/agents"));

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Invalid agent name" }),
    );
    expect(mockWriteAgent).not.toHaveBeenCalled();
  });

  it("returns 409 when agent already exists", async () => {
    mockReadBody.mockResolvedValue({
      name: "existing-agent",
      description: "old",
      content: "old body",
    });
    mockReadAgent.mockResolvedValue({
      name: "existing-agent",
      description: "old",
      content: "old body",
    });

    const req = makeReq("POST");
    const res = makeRes();
    const result = await handleAgentRoutes(req, res, parsedUrl("/api/agents"));

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(409, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Agent already exists" }),
    );
    expect(mockWriteAgent).not.toHaveBeenCalled();
  });

  it("creates and returns 201 when name is valid and does not exist", async () => {
    mockReadBody.mockResolvedValue({
      name: "new-agent",
      description: "A brand new agent",
      content: "agent body",
    });
    mockReadAgent.mockResolvedValue(null);
    mockWriteAgent.mockResolvedValue(undefined);

    const req = makeReq("POST");
    const res = makeRes();
    const result = await handleAgentRoutes(req, res, parsedUrl("/api/agents"));

    expect(result).toBe(true);
    expect(mockWriteAgent).toHaveBeenCalledWith(FAKE_DIR, {
      name: "new-agent",
      description: "A brand new agent",
      content: "agent body",
    });
    expect(res.writeHead).toHaveBeenCalledWith(201, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({
        name: "new-agent",
        description: "A brand new agent",
        content: "agent body",
      }),
    );
  });
});

// ── PUT /api/agents/:name ─────────────────────────────────────────────────────

describe("PUT /api/agents/:name", () => {
  it("returns 400 for an invalid name", async () => {
    const req = makeReq("PUT");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents/INVALID NAME"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Invalid agent name" }),
    );
    expect(mockWriteAgent).not.toHaveBeenCalled();
  });

  it("returns 404 when agent is not found", async () => {
    mockReadAgent.mockResolvedValue(null);

    const req = makeReq("PUT");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents/missing-agent"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(mockWriteAgent).not.toHaveBeenCalled();
  });

  it("updates and returns 200 when agent is found", async () => {
    const existing = {
      name: "my-agent",
      description: "old desc",
      content: "old body",
    };
    mockReadAgent.mockResolvedValue(existing);
    mockReadBody.mockResolvedValue({
      description: "updated desc",
      content: "updated body",
    });
    mockWriteAgent.mockResolvedValue(undefined);

    const req = makeReq("PUT");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents/my-agent"),
    );

    expect(result).toBe(true);
    expect(mockWriteAgent).toHaveBeenCalledWith(FAKE_DIR, {
      name: "my-agent",
      description: "updated desc",
      content: "updated body",
    });
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({
        name: "my-agent",
        description: "updated desc",
        content: "updated body",
      }),
    );
  });
});

// ── DELETE /api/agents/:name ──────────────────────────────────────────────────

describe("DELETE /api/agents/:name", () => {
  it("returns 400 for an invalid name", async () => {
    const req = makeReq("DELETE");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents/INVALID NAME"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      "Content-Type": "application/json",
    });
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ error: "Invalid agent name" }),
    );
    expect(mockDeleteAgent).not.toHaveBeenCalled();
  });

  it("returns 404 when agent is not found", async () => {
    mockReadAgent.mockResolvedValue(null);

    const req = makeReq("DELETE");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents/missing-agent"),
    );

    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
    expect(mockDeleteAgent).not.toHaveBeenCalled();
  });

  it("deletes and returns 204 when agent is found", async () => {
    const existing = {
      name: "my-agent",
      description: "desc",
      content: "body",
    };
    mockReadAgent.mockResolvedValue(existing);
    mockDeleteAgent.mockResolvedValue(undefined);

    const req = makeReq("DELETE");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/agents/my-agent"),
    );

    expect(result).toBe(true);
    expect(mockDeleteAgent).toHaveBeenCalledWith(FAKE_DIR, "my-agent");
    expect(res.writeHead).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});

// ── Non-matching routes ───────────────────────────────────────────────────────

describe("non-matching routes", () => {
  it("returns false for an unrecognised method and path", async () => {
    const req = makeReq("PATCH");
    const res = makeRes();
    const result = await handleAgentRoutes(
      req,
      res,
      parsedUrl("/api/something-else"),
    );

    expect(result).toBe(false);
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("returns false for a GET to an unrelated path", async () => {
    const req = makeReq("GET");
    const res = makeRes();
    const result = await handleAgentRoutes(req, res, parsedUrl("/api/skills"));

    expect(result).toBe(false);
  });
});
