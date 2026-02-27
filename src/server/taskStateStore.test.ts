/**
 * @jest-environment node
 */
import {
  clearAllTaskStateCache,
  deleteTaskState,
  getAllTaskStates,
  getTaskState,
  setTaskState,
} from "./taskStateStore";

import { mkdir, readFile, writeFile } from "node:fs/promises";

jest.mock("node:fs/promises");

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;

beforeEach(() => {
  jest.resetAllMocks();
  clearAllTaskStateCache();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}

describe("getTaskState", () => {
  it("returns empty object when state file does not exist", async () => {
    mockReadFile.mockRejectedValueOnce(enoent());

    const result = await getTaskState("test-repo", "fix-bug");

    expect(result).toEqual({});
  });

  it("returns entry for existing task id", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ "fix-bug": { sessionId: "sess-1" } }) as never,
    );

    const result = await getTaskState("test-repo", "fix-bug");

    expect(result).toEqual({ sessionId: "sess-1" });
  });

  it("returns empty object for missing task id", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ "fix-bug": { sessionId: "sess-1" } }) as never,
    );

    const result = await getTaskState("test-repo", "other-task");

    expect(result).toEqual({});
  });

  it("uses cache on second call", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ "fix-bug": { sessionId: "sess-1" } }) as never,
    );

    await getTaskState("test-repo", "fix-bug");
    const result = await getTaskState("test-repo", "fix-bug");

    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sessionId: "sess-1" });
  });
});

describe("getAllTaskStates", () => {
  it("returns the full state file contents", async () => {
    const data = {
      "fix-bug": { sessionId: "sess-1" },
      "add-feature": { archivedAt: "2026-01-01T00:00:00.000Z" },
    };
    mockReadFile.mockResolvedValueOnce(JSON.stringify(data) as never);

    const result = await getAllTaskStates("test-repo");

    expect(result).toEqual(data);
  });
});

describe("setTaskState", () => {
  it("writes state for a new task", async () => {
    mockReadFile.mockRejectedValueOnce(enoent());

    await setTaskState("test-repo", "fix-bug", { sessionId: "sess-1" });

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(
      mockWriteFile.mock.calls[0][1] as string,
    ) as Record<string, unknown>;
    expect(written["fix-bug"]).toEqual({ sessionId: "sess-1" });
  });

  it("merges with existing data", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ "old-task": { sessionId: "old" } }) as never,
    );

    await setTaskState("test-repo", "fix-bug", { sessionId: "sess-1" });

    const written = JSON.parse(
      mockWriteFile.mock.calls[0][1] as string,
    ) as Record<string, unknown>;
    expect(written["old-task"]).toEqual({ sessionId: "old" });
    expect(written["fix-bug"]).toEqual({ sessionId: "sess-1" });
  });

  it("removes entry when all values are undefined", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ "fix-bug": { sessionId: "sess-1" } }) as never,
    );

    await setTaskState("test-repo", "fix-bug", {});

    const written = JSON.parse(
      mockWriteFile.mock.calls[0][1] as string,
    ) as Record<string, unknown>;
    expect(written["fix-bug"]).toBeUndefined();
  });

  it("does not write when entry does not exist and state is empty", async () => {
    mockReadFile.mockRejectedValueOnce(enoent());

    await setTaskState("test-repo", "fix-bug", {});

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("deleteTaskState", () => {
  it("removes the entry and writes", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({
        "fix-bug": { sessionId: "sess-1" },
        other: { archivedAt: "2026-01-01T00:00:00.000Z" },
      }) as never,
    );

    await deleteTaskState("test-repo", "fix-bug");

    const written = JSON.parse(
      mockWriteFile.mock.calls[0][1] as string,
    ) as Record<string, unknown>;
    expect(written["fix-bug"]).toBeUndefined();
    expect(written["other"]).toEqual({
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("is a no-op when entry does not exist", async () => {
    mockReadFile.mockResolvedValueOnce(JSON.stringify({}) as never);

    await deleteTaskState("test-repo", "fix-bug");

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("clearAllTaskStateCache", () => {
  it("forces re-read from disk on next call", async () => {
    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ "fix-bug": { sessionId: "sess-1" } }) as never,
    );

    await getTaskState("test-repo", "fix-bug");
    clearAllTaskStateCache();

    mockReadFile.mockResolvedValueOnce(
      JSON.stringify({ "fix-bug": { sessionId: "sess-2" } }) as never,
    );

    const result = await getTaskState("test-repo", "fix-bug");

    expect(mockReadFile).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sessionId: "sess-2" });
  });
});
