import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SPECS_DIR = join(process.cwd(), "specs");

export interface StoredMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  options?: { label: string; description?: string }[];
  timestamp: string;
}

export interface TaskStateEntry {
  sessionId?: string;
  archivedAt?: string;
  title?: string;
  claudeSessionIds?: string[];
  messages?: StoredMessage[];
}

type StateFile = Record<string, TaskStateEntry>;

const cache = new Map<string, StateFile>();

// Per-repo write queues to serialize concurrent writes and prevent races.
const writeQueues = new Map<string, Promise<void>>();

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

/**
 * Enqueue a write operation for a repo so concurrent writes are serialized.
 */
function enqueueWrite(repo: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(repo) ?? Promise.resolve();
  const next = prev.then(fn).catch((err: unknown) => {
    console.error(`[taskStateStore] Write error for repo ${repo}:`, err);
  });
  writeQueues.set(repo, next);
  return next;
}

export async function getTaskState(
  repo: string,
  id: string,
): Promise<TaskStateEntry> {
  const data = await readStateFile(repo);
  const entry = data[id] ?? {};

  type LegacyEntry = TaskStateEntry & {
    claudeSessionId?: string;
    userMessages?: string[];
  };
  const raw = entry as LegacyEntry;
  let needsWrite = false;
  const migrated: LegacyEntry = { ...raw };

  // Lazy migration: claudeSessionId (singular) → claudeSessionIds[]
  if (
    raw.claudeSessionId &&
    (!raw.claudeSessionIds || raw.claudeSessionIds.length === 0)
  ) {
    migrated.claudeSessionIds = [raw.claudeSessionId];
    delete migrated.claudeSessionId;
    needsWrite = true;
  }

  // Lazy migration: userMessages[] → messages[]
  if (
    raw.userMessages &&
    raw.userMessages.length > 0 &&
    (!raw.messages || raw.messages.length === 0)
  ) {
    migrated.messages = raw.userMessages.map((text) => ({
      id: randomUUID(),
      role: "user" as const,
      content: text,
      timestamp: new Date(0).toISOString(),
    }));
    delete migrated.userMessages;
    needsWrite = true;
  } else if (raw.userMessages) {
    // messages[] already populated — just drop the stale userMessages
    delete migrated.userMessages;
    needsWrite = true;
  }

  if (needsWrite) {
    // Update the in-memory cache so subsequent reads within this server
    // lifetime see the migrated shape. Disk persistence happens via the
    // startup migration pass (migrateStateFiles) or the next natural write.
    data[id] = migrated as TaskStateEntry;
    return migrated as TaskStateEntry;
  }

  return entry;
}

/**
 * One-time startup migration: scan every entry in a repo's state file and
 * apply any pending field-shape migrations, then persist once.  Should be
 * called from the server startup sequence so the read path never has to write.
 */
export async function migrateStateFiles(repo: string): Promise<void> {
  const data = await readStateFile(repo);
  type LegacyEntry = TaskStateEntry & {
    claudeSessionId?: string;
    userMessages?: string[];
  };
  let changed = false;

  for (const [id, entry] of Object.entries(data)) {
    const raw = entry as LegacyEntry;
    const migrated: LegacyEntry = { ...raw };
    let needsWrite = false;

    if (
      raw.claudeSessionId &&
      (!raw.claudeSessionIds || raw.claudeSessionIds.length === 0)
    ) {
      migrated.claudeSessionIds = [raw.claudeSessionId];
      delete migrated.claudeSessionId;
      needsWrite = true;
    }

    if (
      raw.userMessages &&
      raw.userMessages.length > 0 &&
      (!raw.messages || raw.messages.length === 0)
    ) {
      migrated.messages = raw.userMessages.map((text) => ({
        id: randomUUID(),
        role: "user" as const,
        content: text,
        timestamp: new Date(0).toISOString(),
      }));
      delete migrated.userMessages;
      needsWrite = true;
    } else if (raw.userMessages) {
      delete migrated.userMessages;
      needsWrite = true;
    }

    if (needsWrite) {
      data[id] = migrated as TaskStateEntry;
      changed = true;
    }
  }

  if (changed) {
    await writeStateFile(repo, data);
  }
}

export function getLatestSessionId(state: TaskStateEntry): string | undefined {
  const ids = state.claudeSessionIds ?? [];
  return ids.length > 0 ? ids[ids.length - 1] : undefined;
}

export async function getAllTaskStates(repo: string): Promise<StateFile> {
  return readStateFile(repo);
}

export async function setTaskState(
  repo: string,
  id: string,
  state: TaskStateEntry,
): Promise<void> {
  return enqueueWrite(repo, async () => {
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
    if (state.claudeSessionIds !== undefined) {
      entry.claudeSessionIds = state.claudeSessionIds;
    }
    if (state.messages !== undefined) {
      entry.messages = state.messages;
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
  });
}

/**
 * Update only sessionId / archivedAt / title for a task, leaving
 * claudeSessionIds and messages untouched.  Avoids the extra getTaskState()
 * read that setTaskState() would otherwise require.
 */
export async function patchTaskState(
  repo: string,
  id: string,
  patch: { sessionId?: string; archivedAt?: string; title?: string },
): Promise<void> {
  return enqueueWrite(repo, async () => {
    const data = await readStateFile(repo);
    const existing = data[id] ?? {};
    const updated: TaskStateEntry = { ...existing };

    if (patch.sessionId !== undefined) {
      updated.sessionId = patch.sessionId;
    } else {
      delete updated.sessionId;
    }
    if (patch.archivedAt !== undefined) {
      updated.archivedAt = patch.archivedAt;
    } else {
      delete updated.archivedAt;
    }
    if (patch.title !== undefined) {
      updated.title = patch.title;
    } else {
      delete updated.title;
    }

    if (Object.keys(updated).length === 0) {
      if (data[id]) {
        delete data[id];
        await writeStateFile(repo, data);
      }
      return;
    }
    data[id] = updated;
    await writeStateFile(repo, data);
  });
}

export async function deleteTaskState(repo: string, id: string): Promise<void> {
  return enqueueWrite(repo, async () => {
    const data = await readStateFile(repo);
    if (data[id] === undefined) {
      return;
    }
    delete data[id];
    await writeStateFile(repo, data);
  });
}

export async function appendMessages(
  repo: string,
  id: string,
  newMessages: StoredMessage[],
): Promise<void> {
  if (newMessages.length === 0) {
    return;
  }
  return enqueueWrite(repo, async () => {
    const data = await readStateFile(repo);
    const existing = data[id] ?? {};
    const msgs = existing.messages ?? [];
    data[id] = { ...existing, messages: [...msgs, ...newMessages] };
    await writeStateFile(repo, data);
  });
}

export async function appendClaudeSessionId(
  repo: string,
  id: string,
  sessionId: string,
): Promise<void> {
  return enqueueWrite(repo, async () => {
    const data = await readStateFile(repo);
    const existing = data[id] ?? {};
    const ids = existing.claudeSessionIds ?? [];
    if (!ids.includes(sessionId)) {
      data[id] = { ...existing, claudeSessionIds: [...ids, sessionId] };
      await writeStateFile(repo, data);
    }
  });
}

export function clearAllTaskStateCache(): void {
  cache.clear();
}
