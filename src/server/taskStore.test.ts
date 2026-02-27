/**
 * @jest-environment node
 */
import {
  deleteTaskState,
  getAllTaskStates,
  getTaskState,
  setTaskState,
  clearAllTaskStateCache,
} from "./taskStateStore";
import {
  clearTaskCache,
  deleteTaskFile,
  ensureStatusDirs,
  getUniqueTaskId,
  readAllTasks,
  readTask,
  readTasksForRepo,
  repoSpecsDir,
  SPECS_DIR,
  STATUS_FOLDER,
  STATUS_FOLDERS,
  suppressWatchEvents,
  taskFilePath,
  writeTask,
} from "./taskStore";
import { parseTaskFile, serializeTaskFile } from "../utils/taskFile";
import type { Task } from "../utils/tasks.types";

import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

jest.mock("node:fs/promises");
jest.mock("../utils/taskFile");
jest.mock("./taskStateStore");

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockStat = stat as jest.MockedFunction<typeof stat>;
const _mockRename = rename as jest.MockedFunction<typeof rename>;
const mockParseTaskFile = parseTaskFile as jest.MockedFunction<
  typeof parseTaskFile
>;
const mockSerializeTaskFile = serializeTaskFile as jest.MockedFunction<
  typeof serializeTaskFile
>;
const mockGetTaskState = getTaskState as jest.MockedFunction<
  typeof getTaskState
>;
const mockGetAllTaskStates = getAllTaskStates as jest.MockedFunction<
  typeof getAllTaskStates
>;
const mockSetTaskState = setTaskState as jest.MockedFunction<
  typeof setTaskState
>;
const mockDeleteTaskState = deleteTaskState as jest.MockedFunction<
  typeof deleteTaskState
>;
const _mockClearAllTaskStateCache =
  clearAllTaskStateCache as jest.MockedFunction<typeof clearAllTaskStateCache>;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "fix-login-bug",
    title: "Fix Login Bug",
    status: "Backlog",
    spec: "Some spec body",
    repo: "test-repo",
    ...overrides,
  };
}

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

function eacces(): NodeJS.ErrnoException {
  return Object.assign(new Error("EACCES"), { code: "EACCES" });
}

function dirStat() {
  return { isDirectory: () => true } as ReturnType<typeof stat> extends Promise<
    infer S
  >
    ? S
    : never;
}

beforeEach(() => {
  jest.resetAllMocks();
  clearTaskCache();
  suppressWatchEvents.clear();
  mockGetTaskState.mockResolvedValue({});
  mockGetAllTaskStates.mockResolvedValue({});
  mockSetTaskState.mockResolvedValue(undefined);
  mockDeleteTaskState.mockResolvedValue(undefined);
});

// ── repoSpecsDir ──────────────────────────────────────────────────────────────

describe("repoSpecsDir", () => {
  it("returns the specs dir joined with repo name", () => {
    const result = repoSpecsDir("test-repo");
    expect(result).toBe(join(SPECS_DIR, "test-repo"));
  });
});

// ── taskFilePath ──────────────────────────────────────────────────────────────

describe("taskFilePath", () => {
  it("returns the correct path for a task", () => {
    expect(taskFilePath("fix-login-bug", "test-repo", "Backlog")).toBe(
      join(SPECS_DIR, "test-repo", "backlog", "fix-login-bug.md"),
    );
  });

  it("maps Not Started to not-started folder", () => {
    expect(taskFilePath("fix-login-bug", "test-repo", "Not Started")).toBe(
      join(SPECS_DIR, "test-repo", "not-started", "fix-login-bug.md"),
    );
  });
});

// ── ensureStatusDirs ──────────────────────────────────────────────────────────

describe("ensureStatusDirs", () => {
  it("creates all 5 status subdirs under specs/{repo}/", async () => {
    mockMkdir.mockResolvedValue(undefined);

    await ensureStatusDirs("test-repo");

    expect(mockMkdir).toHaveBeenCalledTimes(5);
    for (const folder of STATUS_FOLDERS) {
      expect(mockMkdir).toHaveBeenCalledWith(
        join(SPECS_DIR, "test-repo", folder),
        { recursive: true },
      );
    }
  });
});

// ── readTask ──────────────────────────────────────────────────────────────────

describe("readTask", () => {
  it("returns null when file is not found in any status subdir", async () => {
    mockReadFile.mockRejectedValue(enoent());

    const result = await readTask("fix-login-bug", "test-repo");

    expect(result).toBeNull();
    expect(mockReadFile).toHaveBeenCalledTimes(STATUS_FOLDERS.length);
  });

  it("re-throws non-ENOENT errors", async () => {
    mockReadFile.mockRejectedValueOnce(enoent());
    mockReadFile.mockRejectedValueOnce(eacces());

    await expect(readTask("fix-login-bug", "test-repo")).rejects.toThrow(
      "EACCES",
    );
  });

  it("finds file in the backlog subdir and returns task with Backlog status", async () => {
    const task = makeTask({ status: "Backlog" });
    mockReadFile.mockRejectedValue(enoent());
    mockReadFile.mockResolvedValueOnce("raw content" as never);
    mockParseTaskFile.mockReturnValueOnce(task);
    mockGetTaskState.mockResolvedValueOnce({});

    const result = await readTask("fix-login-bug", "test-repo");

    expect(mockReadFile).toHaveBeenNthCalledWith(
      1,
      join(SPECS_DIR, "test-repo", "backlog", "fix-login-bug.md"),
      "utf8",
    );
    expect(mockParseTaskFile).toHaveBeenCalledWith(
      "raw content",
      "test-repo",
      "fix-login-bug",
      "Backlog",
    );
    expect(result).toEqual(task);
  });

  it("finds file in the in-progress subdir", async () => {
    const task = makeTask({ status: "In Progress" });
    mockReadFile.mockRejectedValueOnce(enoent());
    mockReadFile.mockRejectedValueOnce(enoent());
    mockReadFile.mockResolvedValueOnce("raw content" as never);
    mockParseTaskFile.mockReturnValueOnce(task);
    mockGetTaskState.mockResolvedValueOnce({});

    const result = await readTask("fix-login-bug", "test-repo");

    expect(mockReadFile).toHaveBeenNthCalledWith(
      3,
      join(SPECS_DIR, "test-repo", "in-progress", "fix-login-bug.md"),
      "utf8",
    );
    expect(mockParseTaskFile).toHaveBeenCalledWith(
      "raw content",
      "test-repo",
      "fix-login-bug",
      "In Progress",
    );
    expect(result).toEqual(task);
  });

  it("merges sessionId from task state store", async () => {
    const task = makeTask({ status: "In Progress" });
    mockReadFile.mockResolvedValueOnce("raw content" as never);
    mockParseTaskFile.mockReturnValueOnce(task);
    mockGetTaskState.mockResolvedValueOnce({ sessionId: "sess-abc" });

    const result = await readTask("fix-login-bug", "test-repo");

    expect(result?.sessionId).toBe("sess-abc");
  });

  it("merges archivedAt from task state store", async () => {
    const task = makeTask({ status: "Done" });
    mockReadFile.mockRejectedValueOnce(enoent());
    mockReadFile.mockRejectedValueOnce(enoent());
    mockReadFile.mockRejectedValueOnce(enoent());
    mockReadFile.mockRejectedValueOnce(enoent());
    mockReadFile.mockResolvedValueOnce("raw content" as never);
    mockParseTaskFile.mockReturnValueOnce(task);
    mockGetTaskState.mockResolvedValueOnce({
      archivedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await readTask("fix-login-bug", "test-repo");

    expect(result?.archivedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ── writeTask ─────────────────────────────────────────────────────────────────

describe("writeTask", () => {
  it("writes to the correct repo/status subdir", async () => {
    const task = makeTask({ status: "In Progress" });
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockRejectedValue(enoent());
    mockWriteFile.mockResolvedValue(undefined);
    mockSerializeTaskFile.mockReturnValueOnce("serialized content");

    await writeTask(task);

    expect(mockMkdir).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "in-progress"),
      { recursive: true },
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "in-progress", "fix-login-bug.md"),
      "serialized content",
      "utf8",
    );
  });

  it("adds task id to suppressWatchEvents before writing", async () => {
    const task = makeTask();
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockRejectedValue(enoent());
    mockWriteFile.mockResolvedValue(undefined);
    mockSerializeTaskFile.mockReturnValueOnce("content");

    await writeTask(task);

    expect(suppressWatchEvents.has("fix-login-bug")).toBe(true);
  });

  it("removes file from old status folder when prevStatus is provided and differs", async () => {
    const task = makeTask({ status: "Done" });
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockSerializeTaskFile.mockReturnValueOnce("content");

    await writeTask(task, "In Progress");

    expect(mockUnlink).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "in-progress", "fix-login-bug.md"),
    );
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "done", "fix-login-bug.md"),
      "content",
      "utf8",
    );
  });

  it("cleans up all other status folders when no prevStatus provided", async () => {
    const task = makeTask({ status: "Done" });
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValueOnce(undefined);
    mockUnlink.mockRejectedValue(enoent());
    mockWriteFile.mockResolvedValue(undefined);
    mockSerializeTaskFile.mockReturnValueOnce("content");

    await writeTask(task);

    expect(mockUnlink).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "backlog", "fix-login-bug.md"),
    );
    expect(mockUnlink).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "not-started", "fix-login-bug.md"),
    );
    expect(mockUnlink).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "in-progress", "fix-login-bug.md"),
    );
    expect(mockUnlink).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "review", "fix-login-bug.md"),
    );
    expect(mockUnlink).not.toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "done", "fix-login-bug.md"),
    );
  });

  it("re-throws non-ENOENT errors from unlink", async () => {
    const task = makeTask({ status: "Done" });
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockRejectedValueOnce(eacces());

    await expect(writeTask(task)).rejects.toThrow("EACCES");
  });

  it("calls setTaskState with sessionId and archivedAt", async () => {
    const task = makeTask({
      status: "Done",
      sessionId: "sess-1",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockRejectedValue(enoent());
    mockWriteFile.mockResolvedValue(undefined);
    mockSerializeTaskFile.mockReturnValueOnce("content");

    await writeTask(task);

    expect(mockSetTaskState).toHaveBeenCalledWith(
      "test-repo",
      "fix-login-bug",
      {
        sessionId: "sess-1",
        archivedAt: "2026-01-01T00:00:00.000Z",
        title: "Fix Login Bug",
      },
    );
  });

  it("updates cache in-place for an existing task", async () => {
    const task1 = makeTask({ id: "fix-login-bug" });
    const task1Updated = makeTask({ id: "fix-login-bug", title: "Updated" });

    mockReaddir.mockResolvedValueOnce(["fix-login-bug.md"] as never);
    mockReadFile.mockResolvedValueOnce("content1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);
    mockReaddir.mockResolvedValue([] as never);

    await readTasksForRepo("test-repo");

    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockRejectedValue(enoent());
    mockWriteFile.mockResolvedValue(undefined);
    mockSerializeTaskFile.mockReturnValueOnce("updated");

    await writeTask(task1Updated);

    const result = await readTasksForRepo("test-repo");
    expect(result).toEqual([task1Updated]);
  });

  it("appends to cache when writing a new task", async () => {
    const task1 = makeTask({ id: "fix-login-bug" });
    const task2 = makeTask({ id: "add-feature" });

    mockReaddir.mockResolvedValueOnce(["fix-login-bug.md"] as never);
    mockReadFile.mockResolvedValueOnce("content1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);
    mockReaddir.mockResolvedValue([] as never);

    await readTasksForRepo("test-repo");

    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockRejectedValue(enoent());
    mockWriteFile.mockResolvedValue(undefined);
    mockSerializeTaskFile.mockReturnValueOnce("content2");

    await writeTask(task2);

    const result = await readTasksForRepo("test-repo");
    expect(result).toEqual(expect.arrayContaining([task1, task2]));
  });
});

// ── deleteTaskFile ────────────────────────────────────────────────────────────

describe("deleteTaskFile", () => {
  it("is a no-op when file is not found (ENOENT)", async () => {
    mockUnlink.mockRejectedValue(enoent());

    await expect(
      deleteTaskFile("fix-login-bug", "test-repo", "Backlog"),
    ).resolves.toBeUndefined();
    expect(mockUnlink).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "backlog", "fix-login-bug.md"),
    );
  });

  it("re-throws non-ENOENT errors", async () => {
    mockUnlink.mockRejectedValueOnce(eacces());

    await expect(
      deleteTaskFile("fix-login-bug", "test-repo", "Backlog"),
    ).rejects.toThrow("EACCES");
  });

  it("deletes file from the correct repo/status subfolder", async () => {
    mockUnlink.mockResolvedValueOnce(undefined);

    await deleteTaskFile("fix-login-bug", "test-repo", "In Progress");

    expect(mockUnlink).toHaveBeenCalledWith(
      join(SPECS_DIR, "test-repo", "in-progress", "fix-login-bug.md"),
    );
  });

  it("calls deleteTaskState after deleting file", async () => {
    mockUnlink.mockResolvedValueOnce(undefined);

    await deleteTaskFile("fix-login-bug", "test-repo", "Backlog");

    expect(mockDeleteTaskState).toHaveBeenCalledWith(
      "test-repo",
      "fix-login-bug",
    );
  });

  it("removes task from cache", async () => {
    const task1 = makeTask({ id: "fix-login-bug" });
    const task2 = makeTask({ id: "add-feature" });

    mockReaddir.mockResolvedValueOnce([
      "fix-login-bug.md",
      "add-feature.md",
    ] as never);
    mockReadFile.mockResolvedValueOnce("c1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);
    mockReadFile.mockResolvedValueOnce("c2" as never);
    mockParseTaskFile.mockReturnValueOnce(task2);
    mockReaddir.mockResolvedValue([] as never);

    await readTasksForRepo("test-repo");

    mockUnlink.mockResolvedValueOnce(undefined);

    await deleteTaskFile("fix-login-bug", "test-repo", "Backlog");

    const result = await readTasksForRepo("test-repo");
    expect(result).toEqual([task2]);
  });
});

// ── readTasksForRepo ──────────────────────────────────────────────────────────

describe("readTasksForRepo", () => {
  it("returns empty array when all status subdirs are missing (ENOENT)", async () => {
    mockReaddir.mockRejectedValue(enoent());

    const result = await readTasksForRepo("test-repo");

    expect(result).toEqual([]);
    expect(mockReaddir).toHaveBeenCalledTimes(STATUS_FOLDERS.length);
  });

  it("re-throws non-ENOENT errors from readdir", async () => {
    mockReaddir.mockRejectedValueOnce(eacces());

    await expect(readTasksForRepo("test-repo")).rejects.toThrow("EACCES");
  });

  it("reads tasks from all 5 status subdirs under specs/{repo}/", async () => {
    const taskBacklog = makeTask({ id: "task-1", status: "Backlog" });
    const taskNotStarted = makeTask({ id: "task-2", status: "Not Started" });
    const taskInProgress = makeTask({ id: "task-3", status: "In Progress" });
    const taskReview = makeTask({ id: "task-4", status: "Review" });
    const taskDone = makeTask({ id: "task-5", status: "Done" });

    mockReaddir.mockResolvedValueOnce(["task-1.md"] as never);
    mockReadFile.mockResolvedValueOnce("c1" as never);
    mockParseTaskFile.mockReturnValueOnce(taskBacklog);
    mockReaddir.mockResolvedValueOnce(["task-2.md"] as never);
    mockReadFile.mockResolvedValueOnce("c2" as never);
    mockParseTaskFile.mockReturnValueOnce(taskNotStarted);
    mockReaddir.mockResolvedValueOnce(["task-3.md"] as never);
    mockReadFile.mockResolvedValueOnce("c3" as never);
    mockParseTaskFile.mockReturnValueOnce(taskInProgress);
    mockReaddir.mockResolvedValueOnce(["task-4.md"] as never);
    mockReadFile.mockResolvedValueOnce("c4" as never);
    mockParseTaskFile.mockReturnValueOnce(taskReview);
    mockReaddir.mockResolvedValueOnce(["task-5.md"] as never);
    mockReadFile.mockResolvedValueOnce("c5" as never);
    mockParseTaskFile.mockReturnValueOnce(taskDone);

    const result = await readTasksForRepo("test-repo");

    expect(result).toHaveLength(5);
    expect(mockParseTaskFile).toHaveBeenCalledWith(
      "c1",
      "test-repo",
      "task-1",
      "Backlog",
    );
    expect(mockParseTaskFile).toHaveBeenCalledWith(
      "c2",
      "test-repo",
      "task-2",
      "Not Started",
    );
    expect(mockParseTaskFile).toHaveBeenCalledWith(
      "c3",
      "test-repo",
      "task-3",
      "In Progress",
    );
    expect(mockParseTaskFile).toHaveBeenCalledWith(
      "c4",
      "test-repo",
      "task-4",
      "Review",
    );
    expect(mockParseTaskFile).toHaveBeenCalledWith(
      "c5",
      "test-repo",
      "task-5",
      "Done",
    );
  });

  it("merges state from getAllTaskStates", async () => {
    const task = makeTask({ id: "fix-bug", status: "In Progress" });

    mockGetAllTaskStates.mockResolvedValueOnce({
      "fix-bug": { sessionId: "sess-1" },
    });
    mockReaddir.mockResolvedValueOnce([] as never); // backlog
    mockReaddir.mockResolvedValueOnce([] as never); // not-started
    mockReaddir.mockResolvedValueOnce(["fix-bug.md"] as never); // in-progress
    mockReadFile.mockResolvedValueOnce("content" as never);
    mockParseTaskFile.mockReturnValueOnce(task);
    mockReaddir.mockResolvedValueOnce([] as never); // review
    mockReaddir.mockResolvedValueOnce([] as never); // done

    const result = await readTasksForRepo("test-repo");

    expect(result[0].sessionId).toBe("sess-1");
  });

  it("ignores non-.md files", async () => {
    const taskBacklog = makeTask({ id: "fix-bug", status: "Backlog" });

    mockReaddir.mockResolvedValueOnce(["fix-bug.md", "README.txt"] as never);
    mockReadFile.mockResolvedValueOnce("c1" as never);
    mockParseTaskFile.mockReturnValueOnce(taskBacklog);
    mockReaddir.mockResolvedValue([] as never);

    const result = await readTasksForRepo("test-repo");

    expect(result).toHaveLength(1);
  });

  it("skips subdirs that are missing (ENOENT) and reads the rest", async () => {
    const task = makeTask({ id: "fix-bug", status: "Done" });

    mockReaddir.mockRejectedValueOnce(enoent());
    mockReaddir.mockRejectedValueOnce(enoent());
    mockReaddir.mockRejectedValueOnce(enoent());
    mockReaddir.mockRejectedValueOnce(enoent());
    mockReaddir.mockResolvedValueOnce(["fix-bug.md"] as never);
    mockReadFile.mockResolvedValueOnce("c1" as never);
    mockParseTaskFile.mockReturnValueOnce(task);

    const result = await readTasksForRepo("test-repo");

    expect(result).toEqual([task]);
  });

  it("omits tasks that return null (ENOENT on individual readFile)", async () => {
    const task1 = makeTask({ id: "fix-bug" });

    mockReaddir.mockResolvedValueOnce(["fix-bug.md", "other-task.md"] as never);
    mockReadFile.mockResolvedValueOnce("content1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);
    mockReadFile.mockRejectedValueOnce(enoent());
    mockReaddir.mockResolvedValue([] as never);

    const result = await readTasksForRepo("test-repo");

    expect(result).toEqual([task1]);
  });

  it("returns cached result on second call without reading disk again", async () => {
    const task1 = makeTask({ id: "fix-bug" });

    mockReaddir.mockResolvedValueOnce(["fix-bug.md"] as never);
    mockReadFile.mockResolvedValueOnce("content1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);
    mockReaddir.mockResolvedValue([] as never);

    await readTasksForRepo("test-repo");
    const result = await readTasksForRepo("test-repo");

    expect(mockReaddir).toHaveBeenCalledTimes(5);
    expect(result).toEqual([task1]);
  });
});

// ── readAllTasks ──────────────────────────────────────────────────────────────

describe("readAllTasks", () => {
  it("returns [] when SPECS_DIR does not exist", async () => {
    mockReaddir.mockRejectedValue(enoent());

    const result = await readAllTasks();

    expect(result).toEqual([]);
  });

  it("returns tasks from multiple repos", async () => {
    const task1 = makeTask({ id: "fix-bug", repo: "repo-a" });
    const task2 = makeTask({ id: "add-feature", repo: "repo-b" });

    mockReaddir.mockResolvedValueOnce(["repo-a", "repo-b"] as never);
    mockStat.mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce(["fix-bug.md"] as never);
    mockReadFile.mockResolvedValueOnce("content1" as never);
    mockParseTaskFile.mockReturnValueOnce(task1);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);

    mockStat.mockResolvedValueOnce(dirStat());
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce(["add-feature.md"] as never);
    mockReadFile.mockResolvedValueOnce("content2" as never);
    mockParseTaskFile.mockReturnValueOnce(task2);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);

    const result = await readAllTasks();

    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([task1, task2]));
  });

  it("re-throws non-ENOENT errors from top-level readdir", async () => {
    mockReaddir.mockRejectedValueOnce(eacces());

    await expect(readAllTasks()).rejects.toThrow("EACCES");
  });

  it("skips non-directory entries under SPECS_DIR", async () => {
    const fileStat = { isDirectory: () => false } as ReturnType<
      typeof stat
    > extends Promise<infer S>
      ? S
      : never;

    mockReaddir.mockResolvedValueOnce(["some-file.json"] as never);
    mockStat.mockResolvedValueOnce(fileStat);

    const result = await readAllTasks();

    expect(result).toEqual([]);
  });
});

// ── getUniqueTaskId ───────────────────────────────────────────────────────────

describe("getUniqueTaskId", () => {
  it("returns the slug when no conflict exists", async () => {
    mockReaddir.mockRejectedValue(enoent());

    const result = await getUniqueTaskId("Fix Login Bug", "test-repo");

    expect(result).toBe("fix-login-bug");
  });

  it("appends -2 when slug already exists", async () => {
    // backlog has the file
    mockReaddir.mockResolvedValueOnce(["fix-login-bug.md"] as never);
    // remaining folders empty
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);

    const result = await getUniqueTaskId("Fix Login Bug", "test-repo");

    expect(result).toBe("fix-login-bug-2");
  });

  it("appends -3 when -2 also exists", async () => {
    mockReaddir.mockResolvedValueOnce([
      "fix-login-bug.md",
      "fix-login-bug-2.md",
    ] as never);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);
    mockReaddir.mockResolvedValueOnce([] as never);

    const result = await getUniqueTaskId("Fix Login Bug", "test-repo");

    expect(result).toBe("fix-login-bug-3");
  });

  it("uses 'untitled' as fallback for empty title", async () => {
    mockReaddir.mockRejectedValue(enoent());

    const result = await getUniqueTaskId("", "test-repo");

    expect(result).toBe("untitled");
  });

  it("handles missing status folders gracefully", async () => {
    mockReaddir.mockRejectedValue(enoent());

    const result = await getUniqueTaskId("New Feature", "test-repo");

    expect(result).toBe("new-feature");
  });
});

// ── STATUS_FOLDER mapping ─────────────────────────────────────────────────────

describe("STATUS_FOLDER mapping", () => {
  it("maps 'Not Started' to 'not-started'", () => {
    expect(STATUS_FOLDER["Not Started"]).toBe("not-started");
  });

  it("maps all 5 statuses", () => {
    expect(STATUS_FOLDER["Backlog"]).toBe("backlog");
    expect(STATUS_FOLDER["Not Started"]).toBe("not-started");
    expect(STATUS_FOLDER["In Progress"]).toBe("in-progress");
    expect(STATUS_FOLDER["Review"]).toBe("review");
    expect(STATUS_FOLDER["Done"]).toBe("done");
  });
});
