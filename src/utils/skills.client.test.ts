// src/utils/skills.client.test.ts
import {
  createSkill,
  deleteSkill,
  fetchSkill,
  fetchSkills,
  updateSkill,
} from "./skills.client";

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

describe("fetchSkills", () => {
  it("fetches skills with no scope query for global", async () => {
    mockFetch.mockReturnValue(
      ok({ skills: [{ name: "bugfix", description: "Fix bugs" }] }),
    );
    const result = await fetchSkills();
    expect(mockFetch).toHaveBeenCalledWith("/api/skills");
    expect(result).toEqual([{ name: "bugfix", description: "Fix bugs" }]);
  });

  it("appends scope+repoId query for repo scope", async () => {
    mockFetch.mockReturnValue(ok({ skills: [] }));
    await fetchSkills("repo", "abc-123");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/skills?scope=repo&repoId=abc-123",
    );
  });

  it("encodes special characters in repoId", async () => {
    mockFetch.mockReturnValue(ok({ skills: [] }));
    await fetchSkills("repo", "my repo/1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/skills?scope=repo&repoId=my%20repo%2F1",
    );
  });

  it("throws when response is not ok", async () => {
    mockFetch.mockReturnValue(err(500));
    await expect(fetchSkills()).rejects.toThrow("Failed to fetch skills");
  });
});

describe("fetchSkill", () => {
  it("fetches a single skill by name", async () => {
    const skill = {
      name: "bugfix",
      description: "Fix bugs",
      content: "# Bugfix",
    };
    mockFetch.mockReturnValue(ok(skill));
    const result = await fetchSkill("bugfix");
    expect(mockFetch).toHaveBeenCalledWith("/api/skills/bugfix");
    expect(result).toEqual(skill);
  });

  it("encodes the skill name in the URL", async () => {
    mockFetch.mockReturnValue(
      ok({ name: "my skill", description: "", content: "" }),
    );
    await fetchSkill("my skill");
    expect(mockFetch).toHaveBeenCalledWith("/api/skills/my%20skill");
  });

  it("throws with the skill name when response is not ok", async () => {
    mockFetch.mockReturnValue(err(404));
    await expect(fetchSkill("missing")).rejects.toThrow(
      "Failed to fetch skill: missing",
    );
  });
});

describe("createSkill", () => {
  it("posts name, description, content as JSON", async () => {
    const skill = { name: "new", description: "New skill", content: "# New" };
    mockFetch.mockReturnValue(ok(skill));
    const result = await createSkill("new", "New skill", "# New");
    expect(mockFetch).toHaveBeenCalledWith("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "new",
        description: "New skill",
        content: "# New",
      }),
    });
    expect(result).toEqual(skill);
  });

  it("throws when creation fails", async () => {
    mockFetch.mockReturnValue(err(400));
    await expect(createSkill("bad", "", "")).rejects.toThrow(
      "Failed to create skill",
    );
  });
});

describe("updateSkill", () => {
  it("puts description and content to the skill URL", async () => {
    const skill = {
      name: "bugfix",
      description: "Updated",
      content: "# Updated",
    };
    mockFetch.mockReturnValue(ok(skill));
    const result = await updateSkill("bugfix", "Updated", "# Updated");
    expect(mockFetch).toHaveBeenCalledWith("/api/skills/bugfix", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Updated", content: "# Updated" }),
    });
    expect(result).toEqual(skill);
  });

  it("throws when update fails", async () => {
    mockFetch.mockReturnValue(err(500));
    await expect(updateSkill("bugfix", "", "")).rejects.toThrow(
      "Failed to update skill",
    );
  });
});

describe("deleteSkill", () => {
  it("sends a DELETE request to the skill URL", async () => {
    mockFetch.mockReturnValue(ok(null, 204));
    await deleteSkill("bugfix");
    expect(mockFetch).toHaveBeenCalledWith("/api/skills/bugfix", {
      method: "DELETE",
    });
  });

  it("does not throw when status is 404 (already gone)", async () => {
    mockFetch.mockReturnValue(err(404));
    await expect(deleteSkill("gone")).resolves.toBeUndefined();
  });

  it("throws for non-404 errors", async () => {
    mockFetch.mockReturnValue(err(500));
    await expect(deleteSkill("bugfix")).rejects.toThrow(
      "Failed to delete skill",
    );
  });
});
