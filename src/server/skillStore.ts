import { readRepos } from "./repoStore";
import {
  parseFrontmatterDoc,
  serializeFrontmatterDoc,
} from "../utils/frontmatterDoc";

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;

export type Skill = { name: string; description: string; content: string };

export function globalSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

export function skillFile(dir: string, name: string): string {
  return join(dir, name, "SKILL.md");
}

export async function ensureSkillsDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function resolveSkillsDir(
  scope: string,
  repoId: string | null,
): Promise<string> {
  if (scope === "repo" && repoId) {
    const repos = await readRepos();
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {
      throw new Error("Repo not found");
    }
    return join(repo.path, ".claude", "skills");
  }
  return globalSkillsDir();
}

export async function listSkills(
  dir: string,
): Promise<{ name: string; description: string }[]> {
  await ensureSkillsDir(dir);
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { name: string; description: string }[] = [];
  await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        try {
          const raw = await readFile(join(dir, e.name, "SKILL.md"), "utf8");
          const parsed = parseFrontmatterDoc(raw, e.name);
          results.push({
            name: parsed.name || e.name,
            description: parsed.description,
          });
        } catch {
          // directory exists but no SKILL.md — skip
        }
      }),
  );
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readSkill(
  dir: string,
  name: string,
): Promise<Skill | null> {
  try {
    const raw = await readFile(skillFile(dir, name), "utf8");
    return parseFrontmatterDoc(raw, name);
  } catch {
    return null;
  }
}

export async function writeSkill(dir: string, skill: Skill): Promise<void> {
  await mkdir(join(dir, skill.name), { recursive: true });
  await writeFile(
    skillFile(dir, skill.name),
    serializeFrontmatterDoc(skill),
    "utf8",
  );
}

export async function deleteSkill(dir: string, name: string): Promise<void> {
  await rm(join(dir, name), { recursive: true, force: true });
}
