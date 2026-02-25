/**
 * @jest-environment node
 */
import { readFile, writeFile } from "node:fs/promises";

import { readRepos, writeRepos } from "./repoStore";

jest.mock("node:fs/promises");

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;

// ── readRepos ─────────────────────────────────────────────────────────────────

describe("readRepos", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("returns [] when file does not exist", async () => {
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const result = await readRepos();

    expect(result).toEqual([]);
  });

  it("returns parsed repos when file exists", async () => {
    const repos = [
      {
        id: "repo-1",
        name: "My Repo",
        path: "/home/user/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "repo-2",
        name: "Other Repo",
        path: "/home/user/other",
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    ];

    mockReadFile.mockResolvedValueOnce(JSON.stringify(repos) as never);

    const result = await readRepos();

    expect(result).toEqual(repos);
  });

  it("re-throws unexpected errors", async () => {
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error("EACCES"), { code: "EACCES" }),
    );

    await expect(readRepos()).rejects.toThrow("EACCES");
  });

  it("re-throws when JSON is malformed", async () => {
    mockReadFile.mockResolvedValueOnce("not valid json{" as never);

    await expect(readRepos()).rejects.toThrow(SyntaxError);
  });
});

// ── writeRepos ────────────────────────────────────────────────────────────────

describe("writeRepos", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("writes repos as pretty-printed JSON with 2-space indent", async () => {
    mockWriteFile.mockResolvedValueOnce(undefined);

    const repos = [
      {
        id: "repo-1",
        name: "Test Repo",
        path: "/path/to/repo",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    await writeRepos(repos);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const [filePath, content, encoding] = mockWriteFile.mock.calls[0];
    expect(filePath).toContain("repos.json");
    expect(encoding).toBe("utf8");
    expect(content).toBe(JSON.stringify(repos, null, 2));
  });

  it("writes an empty array correctly", async () => {
    mockWriteFile.mockResolvedValueOnce(undefined);

    await writeRepos([]);

    const [, content] = mockWriteFile.mock.calls[0];
    expect(content).toBe("[]");
  });
});
