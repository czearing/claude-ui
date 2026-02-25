import { readRepos } from "./repoStore";
import {
  parseFrontmatterDoc,
  serializeFrontmatterDoc,
} from "../utils/frontmatterDoc";

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const AGENT_NAME_RE = /^[a-z0-9-]{1,64}$/;

export type Agent = { name: string; description: string; content: string };

export function globalAgentsDir(): string {
  return join(homedir(), ".claude", "agents");
}

export function agentFile(dir: string, name: string): string {
  return join(dir, `${name}.md`);
}

export async function ensureAgentsDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function resolveAgentsDir(
  scope: string,
  repoId: string | null,
): Promise<string> {
  if (scope === "repo" && repoId) {
    const repos = await readRepos();
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {throw new Error("Repo not found");}
    return join(repo.path, ".claude", "agents");
  }
  return globalAgentsDir();
}

export async function listAgents(
  dir: string,
): Promise<{ name: string; description: string }[]> {
  await ensureAgentsDir(dir);
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { name: string; description: string }[] = [];
  await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map(async (e) => {
        const name = e.name.slice(0, -3); // strip .md
        try {
          const raw = await readFile(join(dir, e.name), "utf8");
          const parsed = parseFrontmatterDoc(raw, name);
          results.push({
            name: parsed.name || name,
            description: parsed.description,
          });
        } catch {
          // unreadable file — skip
        }
      }),
  );
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readAgent(
  dir: string,
  name: string,
): Promise<Agent | null> {
  try {
    const raw = await readFile(agentFile(dir, name), "utf8");
    return parseFrontmatterDoc(raw, name);
  } catch {
    return null;
  }
}

export async function writeAgent(dir: string, agent: Agent): Promise<void> {
  await ensureAgentsDir(dir);
  await writeFile(
    agentFile(dir, agent.name),
    serializeFrontmatterDoc(agent),
    "utf8",
  );
}

export async function deleteAgent(dir: string, name: string): Promise<void> {
  try {
    await unlink(agentFile(dir, name));
  } catch {
    // file already gone — ignore
  }
}
