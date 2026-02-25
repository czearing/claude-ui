// src/utils/agents.client.test.ts
import {
  createAgent,
  deleteAgent,
  fetchAgent,
  fetchAgents,
  updateAgent,
} from "./agents.client";

const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => mockFetch.mockReset());

function ok(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function err(status: number) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({}),
  } as Response);
}

describe("fetchAgents", () => {
  it("fetches agents with no scope query for global", async () => {
    mockFetch.mockReturnValue(
      ok({ agents: [{ name: "reviewer", description: "Reviews code" }] }),
    );
    const result = await fetchAgents();
    expect(mockFetch).toHaveBeenCalledWith("/api/agents");
    expect(result).toEqual([{ name: "reviewer", description: "Reviews code" }]);
  });

  it("appends scope+repoId query for repo scope", async () => {
    mockFetch.mockReturnValue(ok({ agents: [] }));
    await fetchAgents("repo", "abc-123");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agents?scope=repo&repoId=abc-123",
    );
  });

  it("encodes special characters in repoId", async () => {
    mockFetch.mockReturnValue(ok({ agents: [] }));
    await fetchAgents("repo", "my repo/1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agents?scope=repo&repoId=my%20repo%2F1",
    );
  });

  it("throws when response is not ok", async () => {
    mockFetch.mockReturnValue(err(500));
    await expect(fetchAgents()).rejects.toThrow("Failed to fetch agents");
  });
});

describe("fetchAgent", () => {
  it("fetches a single agent by name", async () => {
    const agent = {
      name: "reviewer",
      description: "Reviews code",
      content: "# Reviewer",
    };
    mockFetch.mockReturnValue(ok(agent));
    const result = await fetchAgent("reviewer");
    expect(mockFetch).toHaveBeenCalledWith("/api/agents/reviewer");
    expect(result).toEqual(agent);
  });

  it("encodes the agent name in the URL", async () => {
    mockFetch.mockReturnValue(
      ok({ name: "my agent", description: "", content: "" }),
    );
    await fetchAgent("my agent");
    expect(mockFetch).toHaveBeenCalledWith("/api/agents/my%20agent");
  });

  it("throws with the agent name when response is not ok", async () => {
    mockFetch.mockReturnValue(err(404));
    await expect(fetchAgent("missing")).rejects.toThrow(
      "Failed to fetch agent: missing",
    );
  });
});

describe("createAgent", () => {
  it("posts name, description, content as JSON", async () => {
    const agent = { name: "new", description: "New agent", content: "# New" };
    mockFetch.mockReturnValue(ok(agent));
    const result = await createAgent("new", "New agent", "# New");
    expect(mockFetch).toHaveBeenCalledWith("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "new",
        description: "New agent",
        content: "# New",
      }),
    });
    expect(result).toEqual(agent);
  });

  it("throws when creation fails", async () => {
    mockFetch.mockReturnValue(err(400));
    await expect(createAgent("bad", "", "")).rejects.toThrow(
      "Failed to create agent",
    );
  });
});

describe("updateAgent", () => {
  it("puts description and content to the agent URL", async () => {
    const agent = {
      name: "reviewer",
      description: "Updated",
      content: "# Updated",
    };
    mockFetch.mockReturnValue(ok(agent));
    const result = await updateAgent("reviewer", "Updated", "# Updated");
    expect(mockFetch).toHaveBeenCalledWith("/api/agents/reviewer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Updated", content: "# Updated" }),
    });
    expect(result).toEqual(agent);
  });

  it("throws when update fails", async () => {
    mockFetch.mockReturnValue(err(500));
    await expect(updateAgent("reviewer", "", "")).rejects.toThrow(
      "Failed to update agent",
    );
  });
});

describe("deleteAgent", () => {
  it("sends a DELETE request to the agent URL", async () => {
    mockFetch.mockReturnValue(ok(null, 204));
    await deleteAgent("reviewer");
    expect(mockFetch).toHaveBeenCalledWith("/api/agents/reviewer", {
      method: "DELETE",
    });
  });

  it("does not throw when status is 404 (already gone)", async () => {
    mockFetch.mockReturnValue(err(404));
    await expect(deleteAgent("gone")).resolves.toBeUndefined();
  });

  it("throws for non-404 errors", async () => {
    mockFetch.mockReturnValue(err(500));
    await expect(deleteAgent("reviewer")).rejects.toThrow(
      "Failed to delete agent",
    );
  });
});
