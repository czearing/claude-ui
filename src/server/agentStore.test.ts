/**
 * @jest-environment node
 */
import {
  agentFile,
  deleteAgent,
  ensureAgentsDir,
  globalAgentsDir,
  listAgents,
  readAgent,
  resolveAgentsDir,
  writeAgent,
} from "./agentStore";
import { readRepos } from "./repoStore";
import {
  parseFrontmatterDoc,
  serializeFrontmatterDoc,
} from "../utils/frontmatterDoc";

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

jest.mock("node:fs/promises");
jest.mock("node:os");
jest.mock("./repoStore");
jest.mock("../utils/frontmatterDoc");

const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockHomedir = homedir as jest.MockedFunction<typeof homedir>;
const mockReadRepos = readRepos as jest.MockedFunction<typeof readRepos>;
const mockParseFrontmatterDoc = parseFrontmatterDoc as jest.MockedFunction<
  typeof parseFrontmatterDoc
>;
const mockSerializeFrontmatterDoc =
  serializeFrontmatterDoc as jest.MockedFunction<typeof serializeFrontmatterDoc>;

beforeEach(() => {
  jest.resetAllMocks();
  mockHomedir.mockReturnValue("/home/user");
});

// ── globalAgentsDir ───────────────────────────────────────────────────────────

describe("globalAgentsDir", () => {
  it("returns the correct path under home dir", () => {
    const result = globalAgentsDir();
    expect(result).toBe(join("/home/user", ".claude", "agents"));
  });
});

// ── agentFile ─────────────────────────────────────────────────────────────────

describe("agentFile", () => {
  it("returns {dir}/{name}.md", () => {
    const result = agentFile("/some/dir", "my-agent");
    expect(result).toBe(join("/some/dir", "my-agent.md"));
  });
});

// ── resolveAgentsDir ──────────────────────────────────────────────────────────

describe("resolveAgentsDir", () => {
  it("returns global dir when scope is not 'repo'", async () => {
    const result = await resolveAgentsDir("global", null);
    expect(result).toBe(join("/home/user", ".claude", "agents"));
    expect(mockReadRepos).not.toHaveBeenCalled();
  });

  it("returns global dir when scope is 'repo' but repoId is null", async () => {
    const result = await resolveAgentsDir("repo", null);
    expect(result).toBe(join("/home/user", ".claude", "agents"));
    expect(mockReadRepos).not.toHaveBeenCalled();
  });

  it("returns repo-scoped dir when scope is 'repo' and repo is found", async () => {
    mockReadRepos.mockResolvedValueOnce([
      {
        id: "repo-abc",
        name: "My Repo",
        path: "/home/user/projects/my-repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = await resolveAgentsDir("repo", "repo-abc");

    expect(result).toBe(
      join("/home/user/projects/my-repo", ".claude", "agents"),
    );
  });

  it("throws when scope is 'repo' but repo is not found", async () => {
    mockReadRepos.mockResolvedValueOnce([]);

    await expect(resolveAgentsDir("repo", "repo-missing")).rejects.toThrow(
      "Repo not found",
    );
  });
});

// ── listAgents ────────────────────────────────────────────────────────────────

describe("listAgents", () => {
  it("returns a sorted list of agents from .md files", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);
    mockReaddir.mockResolvedValueOnce([
      { isFile: () => true, name: "zebra.md" },
      { isFile: () => true, name: "alpha.md" },
    ] as never);
    mockReadFile.mockResolvedValueOnce("raw-zebra" as never);
    mockParseFrontmatterDoc.mockReturnValueOnce({
      name: "zebra",
      description: "Zebra agent",
      content: "",
    });
    mockReadFile.mockResolvedValueOnce("raw-alpha" as never);
    mockParseFrontmatterDoc.mockReturnValueOnce({
      name: "alpha",
      description: "Alpha agent",
      content: "",
    });

    const result = await listAgents("/agents/dir");

    expect(result).toEqual([
      { name: "alpha", description: "Alpha agent" },
      { name: "zebra", description: "Zebra agent" },
    ]);
  });

  it("skips unreadable files", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);
    mockReaddir.mockResolvedValueOnce([
      { isFile: () => true, name: "good.md" },
      { isFile: () => true, name: "bad.md" },
    ] as never);
    mockReadFile.mockResolvedValueOnce("raw-good" as never);
    mockParseFrontmatterDoc.mockReturnValueOnce({
      name: "good",
      description: "Good agent",
      content: "",
    });
    mockReadFile.mockRejectedValueOnce(new Error("EACCES"));

    const result = await listAgents("/agents/dir");

    expect(result).toEqual([{ name: "good", description: "Good agent" }]);
  });

  it("ignores non-.md files", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);
    mockReaddir.mockResolvedValueOnce([
      { isFile: () => true, name: "agent.md" },
      { isFile: () => true, name: "README.txt" },
      { isFile: () => false, name: "subdir" },
    ] as never);
    mockReadFile.mockResolvedValueOnce("raw" as never);
    mockParseFrontmatterDoc.mockReturnValueOnce({
      name: "agent",
      description: "An agent",
      content: "",
    });

    const result = await listAgents("/agents/dir");

    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ name: "agent", description: "An agent" }]);
  });
});

// ── readAgent ─────────────────────────────────────────────────────────────────

describe("readAgent", () => {
  it("returns null on error", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

    const result = await readAgent("/agents/dir", "my-agent");

    expect(result).toBeNull();
  });

  it("returns parsed agent on success", async () => {
    mockReadFile.mockResolvedValueOnce("raw content" as never);
    mockParseFrontmatterDoc.mockReturnValueOnce({
      name: "my-agent",
      description: "Does things",
      content: "Agent body",
    });

    const result = await readAgent("/agents/dir", "my-agent");

    expect(mockReadFile).toHaveBeenCalledWith(
      join("/agents/dir", "my-agent.md"),
      "utf8",
    );
    expect(mockParseFrontmatterDoc).toHaveBeenCalledWith("raw content", "my-agent");
    expect(result).toEqual({
      name: "my-agent",
      description: "Does things",
      content: "Agent body",
    });
  });
});

// ── writeAgent ────────────────────────────────────────────────────────────────

describe("writeAgent", () => {
  it("ensures dir exists and writes the file", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);
    mockSerializeFrontmatterDoc.mockReturnValueOnce("serialized content");

    const agent = { name: "my-agent", description: "Does things", content: "body" };
    await writeAgent("/agents/dir", agent);

    expect(mockMkdir).toHaveBeenCalledWith("/agents/dir", { recursive: true });
    expect(mockSerializeFrontmatterDoc).toHaveBeenCalledWith(agent);
    expect(mockWriteFile).toHaveBeenCalledWith(
      join("/agents/dir", "my-agent.md"),
      "serialized content",
      "utf8",
    );
  });
});

// ── deleteAgent ───────────────────────────────────────────────────────────────

describe("deleteAgent", () => {
  it("does not throw when file is already gone", async () => {
    mockUnlink.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await expect(deleteAgent("/agents/dir", "my-agent")).resolves.toBeUndefined();
  });

  it("calls unlink with the correct path", async () => {
    mockUnlink.mockResolvedValueOnce(undefined);

    await deleteAgent("/agents/dir", "my-agent");

    expect(mockUnlink).toHaveBeenCalledWith(join("/agents/dir", "my-agent.md"));
  });
});

// ── ensureAgentsDir ───────────────────────────────────────────────────────────

describe("ensureAgentsDir", () => {
  it("calls mkdir with recursive: true", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);

    await ensureAgentsDir("/agents/dir");

    expect(mockMkdir).toHaveBeenCalledWith("/agents/dir", { recursive: true });
  });
});
