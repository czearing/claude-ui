/**
 * @jest-environment node
 */
import {
  deleteTaskFile,
  ensureSpecsDir,
  getNextTaskId,
  readAllTasks,
  readTask,
  readTasksForRepo,
  repoSpecsDir,
  SPECS_DIR,
  writeTask,
} from "./taskStore";
import { parseTaskFile, serializeTaskFile } from "../utils/taskFile";
import type { Task } from "../utils/tasks.types";

import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

jest.mock("node:fs/promises");
jest.mock("../utils/taskFile");

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockParseTaskFile = parseTaskFile as jest.MockedFunction<
  typeof parseTaskFile
>;
const mockSerializeTaskFile = serializeTaskFile as jest.MockedFunction<
  typeof serializeTaskFile
>;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-001",
    title: "Test Task",
    status: "Backlog",
    priority: "Medium",
    spec: "Some spec body",
    repoId: "repo-abc",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

function eacces(): NodeJS.ErrnoException {
  return Object.assign(new Error("EACCES"), { code: "EACCES" });
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ── repoSpecsDir ──────────────────────────────────────────────────────────────

describe("repoSpecsDir", () => {
  it("returns the specs dir joined with repoId", () => {
    const result = repoSpecsDir("repo-123");
    expect(result).toBe(join(SPECS_DIR, "repo-123"));
  });
});

// ── readTask ──────────────────────────────────────────────────────────────────

describe("readTask", () => {
  it("returns null on ENOENT", async () => {
    mockReadFile.mockRejectedValueOnce(enoent());

    const result = await readTask("TASK-001", "repo-abc");

    expect(result).toBeNull();
  });

  it("re-throws non-ENOENT errors", async () => {
    mockReadFile.mockRejectedValueOnce(eacces());

    await expect(readTask("TASK-001", "repo-abc")).rejects.toThrow("EACCES");
  });

  it("returns parsed task on success", async () => {
    const task = makeTask();
    mockReadFile.mockResolvedValueOnce("raw content" as never);
    mockParseTaskFile.mockReturnValueOnce(task);

    const result = await readTask("TASK-001", "repo-abc");

    expect(mockReadFile).toHaveBeenCalledWith(
      join(SPECS_DIR, "repo-abc", "TASK-001.md"),
      "utf8",
    );
    expect(mockParseTaskFile).toHaveBeenCalledWith("raw content");
    expect(result).toEqual(task);
  });
});

// ── writeTask ─────────────────────────────────────────────────────────────────

describe("writeTask", () => {
  it("writes to the correct path with serialized content", async () => {
    const task = makeTask();
    mockMkdir.mockResolvedValueOnce(undefined);
    mockWriteFile.mockResolvedValueOnce(undefined);
    mockSerializeTaskFile.mockReturnValueOnce("serialized content");

    await writeTask(task);

    expect(mockMkdir).toHaveBeenCalledWith(join(SPECS_DIR, "repo-abc"), {
      recursive: true,
    });
    expect(mockSerializeTaskFile).toHaveBeenCalledWith(task);
    expect(mockWriteFile).toHaveBeenCalledWith(
      join(SPECS_DIR, "repo-abc", "TASK-001.md"),
      "serialized content",
      "utf8",
    );
  });
});

// ── deleteTaskFile ────────────────────────────────────────────────────────────

describe("deleteTaskFile", () => {
  it("does not throw on ENOENT", async () => {
    mockUnlink.mockRejectedValueOnce(enoent());

    await expect(
      deleteTaskFile("TASK-001", "repo-abc"),
    ).resolves.toBeUndefined();
  });

  it("re-throws non-ENOENT errors", async () => {
    mockUnlink.mockRejectedValueOnce(eacces());

    await expect(deleteTaskFile("TASK-001", "repo-abc")).rejects.toThrow(
      "EACCES",
    );
  });

  it("calls unlink with the correct path on success", async () => {
    mockUnlink.mockResolvedValueOnce(undefined);

    await deleteTaskFile("TASK-001", "repo-abc");

    expect(mockUnlink).toHaveBeenCalledWith(
      join(SPECS_DIR, "repo-abc", "TASK-001.md"),
    );
  });
});

// ── readTasksForRepo ──────────────────────────────────────────────────────────

describe("readTasksForRepo", () => {
  it("returns empty array when dir not found (ENOENT)", async () => {
    mockReaddir.mockRejectedValueOnce(enoent());

    const result = await readTasksForRepo("repo-abc");

    expect(result).toEqual([]);
  });

  it("re-throws non-ENOENT errors from readdir", async () => {
    mockReaddir.mockRejectedValueOnce(eacces());

    await expect(readTasksForRepo("repo-abc")).rejects.toThrow("EACCES");
  });

  it("returns tasks parsed from .md files, ignoring non-.md files", async () => {
    const task1 = makeTask({ id: "TASK-001" });
    const task2 = makeTask({ id: "TASK-002" });

    mockReaddir.mockResolvedValueOnce([
      "TASK-001.md",
      "TASK-002.md",
      "README.txt",
    ] as never);
    // readTask calls readFile then parseTaskFile — two .md files means two readFile calls
    mockReadFile.mockResolvedValueOnce("content1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);
    mockReadFile.mockResolvedValueOnce("content2" as never);
    mockParseTaskFile.mockReturnValueOnce(task2);

    const result = await readTasksForRepo("repo-abc");

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([task1, task2]));
  });

  it("omits tasks that return null (ENOENT on individual readFile)", async () => {
    const task1 = makeTask({ id: "TASK-001" });

    mockReaddir.mockResolvedValueOnce(["TASK-001.md", "TASK-002.md"] as never);
    mockReadFile.mockResolvedValueOnce("content1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);
    mockReadFile.mockRejectedValueOnce(enoent());

    const result = await readTasksForRepo("repo-abc");

    expect(result).toEqual([task1]);
  });
});

// ── readAllTasks ──────────────────────────────────────────────────────────────

describe("readAllTasks", () => {
  it("returns [] when SPECS_DIR does not exist", async () => {
    mockReaddir.mockRejectedValueOnce(enoent());

    const result = await readAllTasks();

    expect(result).toEqual([]);
  });

  it("returns all tasks across multiple repo subdirectories", async () => {
    const task1 = makeTask({ id: "TASK-001", repoId: "repo-a" });
    const task2 = makeTask({ id: "TASK-002", repoId: "repo-b" });
    const dirStat = { isDirectory: () => true } as ReturnType<
      typeof stat
    > extends Promise<infer S>
      ? S
      : never;

    // outer readdir: two repo dirs
    mockReaddir.mockResolvedValueOnce(["repo-a", "repo-b"] as never);
    // stat calls — both are directories
    mockStat.mockResolvedValueOnce(dirStat);
    mockStat.mockResolvedValueOnce(dirStat);
    // readTasksForRepo("repo-a") → readdir + readFile + parseTaskFile
    mockReaddir.mockResolvedValueOnce(["TASK-001.md"] as never);
    mockReadFile.mockResolvedValueOnce("content1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);
    // readTasksForRepo("repo-b") → readdir + readFile + parseTaskFile
    mockReaddir.mockResolvedValueOnce(["TASK-002.md"] as never);
    mockReadFile.mockResolvedValueOnce("content2" as never);
    mockParseTaskFile.mockReturnValueOnce(task2);

    const result = await readAllTasks();

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([task1, task2]));
  });

  it("silently skips a subdirectory when stat throws", async () => {
    const task1 = makeTask({ id: "TASK-001", repoId: "repo-a" });
    const dirStat = { isDirectory: () => true } as ReturnType<
      typeof stat
    > extends Promise<infer S>
      ? S
      : never;

    // outer readdir: two repo dirs
    mockReaddir.mockResolvedValueOnce(["repo-a", "repo-bad"] as never);
    // stat for repo-a succeeds, stat for repo-bad throws
    mockStat.mockResolvedValueOnce(dirStat);
    mockStat.mockRejectedValueOnce(eacces());
    // readTasksForRepo("repo-a") → readdir + readFile + parseTaskFile
    mockReaddir.mockResolvedValueOnce(["TASK-001.md"] as never);
    mockReadFile.mockResolvedValueOnce("content1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);

    const result = await readAllTasks();

    expect(result).toEqual([task1]);
  });
});

// ── getNextTaskId ─────────────────────────────────────────────────────────────

describe("getNextTaskId", () => {
  it("returns TASK-001 when SPECS_DIR does not exist", async () => {
    mockReaddir.mockRejectedValueOnce(enoent());

    const result = await getNextTaskId();

    expect(result).toBe("TASK-001");
  });

  it("returns TASK-001 when SPECS_DIR is empty", async () => {
    // outer readdir returns no dirs
    mockReaddir.mockResolvedValueOnce([] as never);

    const result = await getNextTaskId();

    expect(result).toBe("TASK-001");
  });

  it("returns the next number after the highest TASK-NNN.md found", async () => {
    const statMock = { isDirectory: () => true } as ReturnType<
      typeof stat
    > extends Promise<infer S>
      ? S
      : never;

    // outer readdir: two repo dirs
    mockReaddir.mockResolvedValueOnce(["repo-a", "repo-b"] as never);
    // stat calls for each dir
    mockStat.mockResolvedValueOnce(statMock);
    mockStat.mockResolvedValueOnce(statMock);
    // inner readdir for repo-a: TASK-003, TASK-007
    mockReaddir.mockResolvedValueOnce(["TASK-003.md", "TASK-007.md"] as never);
    // inner readdir for repo-b: TASK-005
    mockReaddir.mockResolvedValueOnce(["TASK-005.md"] as never);

    const result = await getNextTaskId();

    expect(result).toBe("TASK-008");
  });

  it("pads the number to 3 digits", async () => {
    const statMock = { isDirectory: () => true } as ReturnType<
      typeof stat
    > extends Promise<infer S>
      ? S
      : never;

    mockReaddir.mockResolvedValueOnce(["repo-a"] as never);
    mockStat.mockResolvedValueOnce(statMock);
    mockReaddir.mockResolvedValueOnce(["TASK-099.md"] as never);

    const result = await getNextTaskId();

    expect(result).toBe("TASK-100");
  });

  it("skips non-directory entries", async () => {
    const fileStat = { isDirectory: () => false } as ReturnType<
      typeof stat
    > extends Promise<infer S>
      ? S
      : never;

    mockReaddir.mockResolvedValueOnce(["some-file.json"] as never);
    mockStat.mockResolvedValueOnce(fileStat);

    const result = await getNextTaskId();

    expect(result).toBe("TASK-001");
  });
});

// ── ensureSpecsDir ────────────────────────────────────────────────────────────

describe("ensureSpecsDir", () => {
  it("calls mkdir with recursive: true for the repo's specs dir", async () => {
    mockMkdir.mockResolvedValueOnce(undefined);

    await ensureSpecsDir("repo-xyz");

    expect(mockMkdir).toHaveBeenCalledWith(join(SPECS_DIR, "repo-xyz"), {
      recursive: true,
    });
  });
});
