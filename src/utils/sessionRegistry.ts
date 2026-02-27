import { readFile, writeFile } from "node:fs/promises";

export type SessionRegistryEntry = {
  id: string;
  cwd: string;
  taskId?: string;
  createdAt: string;
  claudeSessionId?: string;
};

export async function loadRegistry(
  filePath: string,
): Promise<Map<string, SessionRegistryEntry>> {
  const map = new Map<string, SessionRegistryEntry>();
  try {
    const data = await readFile(filePath, "utf-8");
    const entries = JSON.parse(data) as SessionRegistryEntry[];
    for (const e of entries) {
      map.set(e.id, e);
    }
  } catch {
    // File doesn't exist yet — return empty map
  }
  return map;
}

export async function saveRegistry(
  filePath: string,
  registry: Map<string, SessionRegistryEntry>,
): Promise<void> {
  const entries = Array.from(registry.values());
  await writeFile(filePath, JSON.stringify(entries, null, 2));
}
