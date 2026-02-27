import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SPECS_DIR = join(process.cwd(), "specs");

export interface TaskStateEntry {
  sessionId?: string;
  archivedAt?: string;
  title?: string;
}

type StateFile = Record<string, TaskStateEntry>;

const cache = new Map<string, StateFile>();

function stateFilePath(repo: string): string {
  return join(SPECS_DIR, repo, ".taskstate.json");
}

async function readStateFile(repo: string): Promise<StateFile> {
  const cached = cache.get(repo);
  if (cached) {
    return cached;
  }

  const filePath = stateFilePath(repo);
  try {
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw) as StateFile;
    cache.set(repo, data);
    return data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const empty: StateFile = {};
      cache.set(repo, empty);
      return empty;
    }
    throw err;
  }
}

async function writeStateFile(repo: string, data: StateFile): Promise<void> {
  const filePath = stateFilePath(repo);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  cache.set(repo, data);
}

export async function getTaskState(
  repo: string,
  id: string,
): Promise<TaskStateEntry> {
  const data = await readStateFile(repo);
  return data[id] ?? {};
}

export async function getAllTaskStates(repo: string): Promise<StateFile> {
  return readStateFile(repo);
}

export async function setTaskState(
  repo: string,
  id: string,
  state: TaskStateEntry,
): Promise<void> {
  const data = await readStateFile(repo);
  // Only store non-undefined values
  const entry: TaskStateEntry = {};
  if (state.sessionId !== undefined) {
    entry.sessionId = state.sessionId;
  }
  if (state.archivedAt !== undefined) {
    entry.archivedAt = state.archivedAt;
  }
  if (state.title !== undefined) {
    entry.title = state.title;
  }

  if (Object.keys(entry).length === 0) {
    // Nothing to store — clean up if entry exists
    if (data[id]) {
      delete data[id];
      await writeStateFile(repo, data);
    }
    return;
  }
  data[id] = entry;
  await writeStateFile(repo, data);
}

export async function deleteTaskState(repo: string, id: string): Promise<void> {
  const data = await readStateFile(repo);
  if (data[id] === undefined) {
    return;
  }
  delete data[id];
  await writeStateFile(repo, data);
}

export function clearAllTaskStateCache(): void {
  cache.clear();
}
