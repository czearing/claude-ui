/**
 * @jest-environment node
 */
import { readRepos } from "./repoStore";
import {
  deleteSkill,
  ensureSkillsDir,
  globalSkillsDir,
  listSkills,
  readSkill,
  resolveSkillsDir,
  skillFile,
  writeSkill,
} from "./skillStore";
import {
  parseFrontmatterDoc,
  serializeFrontmatterDoc,
} from "../utils/frontmatterDoc";

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

jest.mock("node:fs/promises");
jest.mock("node:os");
jest.mock("./repoStore");
jest.mock("../utils/frontmatterDoc");

const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockRm = rm as jest.MockedFunction<typeof rm>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockHomedir = homedir as jest.MockedFunction<typeof homedir>;
const mockReadRepos = readRepos as jest.MockedFunction<typeof readRepos>;
const mockParseFrontmatterDoc = parseFrontmatterDoc as jest.MockedFunction<
  typeof parseFrontmatterDoc
>;
const mockSerializeFrontmatterDoc =
  serializeFrontmatterDoc as jest.MockedFunction<
    typeof serializeFrontmatterDoc
  >;

beforeEach(() => {
  jest.resetAllMocks();
  mockHomedir.mockReturnValue("/home/user");
});

// ── globalSkillsDir ───────────────────────────────────────────────────────────

describe("globalSkillsDir", () => {
  it("returns the correct path using homedir", () => {
    const result = globalSkillsDir();
    expect(result).toBe(join("/home/user", ".claude", "skills"));
  });
});

// ── skillFile ─────────────────────────────────────────────────────────────────

describe("skillFile", () => {
  it("returns the correct SKILL.md path", () => {
    const result = skillFile("/some/dir", "my-skill");
    expect(result).toBe(join("/some/dir", "my-skill", "SKILL.md"));
  });
});

// ── resolveSkillsDir ──────────────────────────────────────────────────────────

describe("resolveSkillsDir", () => {
  it("returns global dir when scope is not 'repo'", async () => {
    const result = await resolveSkillsDir("global", null);
    expect(result).toBe(join("/home/user", ".claude", "skills"));
    expect(mockReadRepos).not.toHaveBeenCalled();
  });

  it("returns global dir when scope is 'repo' but repoId is null", async () => {
    const result = await resolveSkillsDir("repo", null);
    expect(result).toBe(join("/home/user", ".claude", "skills"));
    expect(mockReadRepos).not.toHaveBeenCalled();
  });

  it("returns repo-scoped dir when scope is 'repo' and repo is found", async () => {
    mockReadRepos.mockResolvedValueOnce([
      {
        id: "repo-1",
        name: "My Repo",
        path: "/projects/my-repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = await resolveSkillsDir("repo", "My Repo");

    expect(result).toBe(join("/projects/my-repo", ".claude", "skills"));
  });

  it("throws when scope is 'repo' and repo is not found", async () => {
    mockReadRepos.mockResolvedValueOnce([]);

    await expect(resolveSkillsDir("repo", "nonexistent")).rejects.toThrow(
      "Repo not found",
    );
  });
});

// ── listSkills ────────────────────────────────────────────────────────────────

describe("listSkills", () => {
  it("returns a sorted list of skills", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);
    mockReaddir.mockResolvedValueOnce([
      { name: "zebra-skill", isDirectory: () => true },
      { name: "alpha-skill", isDirectory: () => true },
    ] as never);
    mockReadFile
      .mockResolvedValueOnce("raw-zebra" as never)
      .mockResolvedValueOnce("raw-alpha" as never);
    mockParseFrontmatterDoc
      .mockReturnValueOnce({
        name: "zebra-skill",
        description: "Z skill",
        content: "",
      })
      .mockReturnValueOnce({
        name: "alpha-skill",
        description: "A skill",
        content: "",
      });

    const result = await listSkills("/skills");

    expect(result).toEqual([
      { name: "alpha-skill", description: "A skill" },
      { name: "zebra-skill", description: "Z skill" },
    ]);
  });

  it("skips entries that do not have a SKILL.md", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);
    mockReaddir.mockResolvedValueOnce([
      { name: "good-skill", isDirectory: () => true },
      { name: "broken-skill", isDirectory: () => true },
    ] as never);
    mockReadFile
      .mockResolvedValueOnce("raw-good" as never)
      .mockRejectedValueOnce(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );
    mockParseFrontmatterDoc.mockReturnValueOnce({
      name: "good-skill",
      description: "Good",
      content: "",
    });

    const result = await listSkills("/skills");

    expect(result).toEqual([{ name: "good-skill", description: "Good" }]);
  });

  it("skips non-directory entries", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);
    mockReaddir.mockResolvedValueOnce([
      { name: "not-a-dir.md", isDirectory: () => false },
    ] as never);

    const result = await listSkills("/skills");

    expect(result).toEqual([]);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("uses entry name as fallback when parsed name is empty", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);
    mockReaddir.mockResolvedValueOnce([
      { name: "my-skill", isDirectory: () => true },
    ] as never);
    mockReadFile.mockResolvedValueOnce("raw" as never);
    mockParseFrontmatterDoc.mockReturnValueOnce({
      name: "",
      description: "desc",
      content: "",
    });

    const result = await listSkills("/skills");

    expect(result).toEqual([{ name: "my-skill", description: "desc" }]);
  });
});

// ── readSkill ─────────────────────────────────────────────────────────────────

describe("readSkill", () => {
  it("returns null on error", async () => {
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const result = await readSkill("/skills", "missing-skill");

    expect(result).toBeNull();
  });

  it("returns parsed skill on success", async () => {
    mockReadFile.mockResolvedValueOnce("raw content" as never);
    mockParseFrontmatterDoc.mockReturnValueOnce({
      name: "my-skill",
      description: "Does stuff",
      content: "skill body",
    });

    const result = await readSkill("/skills", "my-skill");

    expect(mockReadFile).toHaveBeenCalledWith(
      join("/skills", "my-skill", "SKILL.md"),
      "utf8",
    );
    expect(mockParseFrontmatterDoc).toHaveBeenCalledWith(
      "raw content",
      "my-skill",
    );
    expect(result).toEqual({
      name: "my-skill",
      description: "Does stuff",
      content: "skill body",
    });
  });
});

// ── writeSkill ────────────────────────────────────────────────────────────────

describe("writeSkill", () => {
  it("creates dir and writes SKILL.md", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);
    mockSerializeFrontmatterDoc.mockReturnValueOnce("serialized");

    const skill = { name: "my-skill", description: "desc", content: "body" };
    await writeSkill("/skills", skill);

    expect(mockMkdir).toHaveBeenCalledWith(join("/skills", "my-skill"), {
      recursive: true,
    });
    expect(mockSerializeFrontmatterDoc).toHaveBeenCalledWith(skill);
    expect(mockWriteFile).toHaveBeenCalledWith(
      join("/skills", "my-skill", "SKILL.md"),
      "serialized",
      "utf8",
    );
  });
});

// ── deleteSkill ───────────────────────────────────────────────────────────────

describe("deleteSkill", () => {
  it("calls rm with recursive and force options", async () => {
    mockRm.mockResolvedValueOnce(undefined);

    await deleteSkill("/skills", "my-skill");

    expect(mockRm).toHaveBeenCalledWith(join("/skills", "my-skill"), {
      recursive: true,
      force: true,
    });
  });
});

// ── ensureSkillsDir ───────────────────────────────────────────────────────────

describe("ensureSkillsDir", () => {
  it("calls mkdir with recursive: true", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);

    await ensureSkillsDir("/skills/dir");

    expect(mockMkdir).toHaveBeenCalledWith("/skills/dir", { recursive: true });
  });
});
