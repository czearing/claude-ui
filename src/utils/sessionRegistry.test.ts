/**
 * @jest-environment node
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRegistry, saveRegistry } from "./sessionRegistry";
import type { SessionRegistryEntry } from "./sessionRegistry";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "session-registry-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function registryFile() {
  return join(dir, "sessions-registry.json");
}

describe("loadRegistry", () => {
  it("returns an empty map when the file does not exist", async () => {
    const map = await loadRegistry(registryFile());
    expect(map.size).toBe(0);
  });

  it("loads entries from an existing file", async () => {
    const entries: SessionRegistryEntry[] = [
      { id: "abc", cwd: "/tmp/repo-a", createdAt: "2026-01-01T00:00:00.000Z" },
      {
        id: "def",
        cwd: "/tmp/repo-b",
        taskId: "task-1",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    const { writeFile } = await import("node:fs/promises");
    await writeFile(registryFile(), JSON.stringify(entries));

    const map = await loadRegistry(registryFile());

    expect(map.size).toBe(2);
    expect(map.get("abc")).toEqual(entries[0]);
    expect(map.get("def")).toEqual(entries[1]);
  });

  it("returns an empty map when the file contains invalid JSON", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(registryFile(), "not-json");

    const map = await loadRegistry(registryFile());
    expect(map.size).toBe(0);
  });
});

describe("saveRegistry", () => {
  it("writes all entries to disk as JSON", async () => {
    const map = new Map<string, SessionRegistryEntry>([
      [
        "abc",
        {
          id: "abc",
          cwd: "/tmp/repo-a",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    ]);

    await saveRegistry(registryFile(), map);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(registryFile(), "utf-8");
    const parsed = JSON.parse(raw) as SessionRegistryEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(map.get("abc"));
  });

  it("overwrites the file on repeated saves", async () => {
    const map = new Map<string, SessionRegistryEntry>([
      [
        "abc",
        {
          id: "abc",
          cwd: "/tmp/repo-a",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    ]);

    await saveRegistry(registryFile(), map);

    map.delete("abc");
    map.set("xyz", {
      id: "xyz",
      cwd: "/tmp/repo-b",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    await saveRegistry(registryFile(), map);

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(registryFile(), "utf-8");
    const parsed = JSON.parse(raw) as SessionRegistryEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe("xyz");
  });

  it("writes an empty array for an empty map", async () => {
    await saveRegistry(registryFile(), new Map());

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(registryFile(), "utf-8");
    expect(JSON.parse(raw)).toEqual([]);
  });
});

describe("round-trip: save then load", () => {
  it("preserves all fields including optional taskId", async () => {
    const map = new Map<string, SessionRegistryEntry>([
      [
        "s1",
        {
          id: "s1",
          cwd: "/tmp/project",
          taskId: "t-42",
          createdAt: "2026-02-25T12:00:00.000Z",
        },
      ],
      [
        "s2",
        { id: "s2", cwd: "/tmp/other", createdAt: "2026-02-25T13:00:00.000Z" },
      ],
    ]);

    await saveRegistry(registryFile(), map);
    const loaded = await loadRegistry(registryFile());

    expect(loaded.size).toBe(2);
    expect(loaded.get("s1")).toEqual(map.get("s1"));
    expect(loaded.get("s2")).toEqual(map.get("s2"));
  });
});
