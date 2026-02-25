// src/utils/skills.client.ts

export type SkillScope = "global" | "repo";

export interface Skill {
  name: string;
  description: string;
  content: string;
}

function scopeQuery(scope: SkillScope, repoId?: string): string {
  if (scope === "repo" && repoId) {
    return `?scope=repo&repoId=${encodeURIComponent(repoId)}`;
  }
  return "";
}

export async function fetchSkills(
  scope: SkillScope = "global",
  repoId?: string,
): Promise<{ name: string; description: string }[]> {
  const res = await fetch(`/api/skills${scopeQuery(scope, repoId)}`);
  if (!res.ok) {
    throw new Error("Failed to fetch skills");
  }
  const data = (await res.json()) as {
    skills: { name: string; description: string }[];
  };
  return data.skills;
}

export async function fetchSkill(
  name: string,
  scope: SkillScope = "global",
  repoId?: string,
): Promise<Skill> {
  const res = await fetch(
    `/api/skills/${encodeURIComponent(name)}${scopeQuery(scope, repoId)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch skill: ${name}`);
  }
  return res.json() as Promise<Skill>;
}

export async function createSkill(
  name: string,
  description: string,
  content: string,
  scope: SkillScope = "global",
  repoId?: string,
): Promise<Skill> {
  const res = await fetch(`/api/skills${scopeQuery(scope, repoId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, content }),
  });
  if (!res.ok) {
    throw new Error("Failed to create skill");
  }
  return res.json() as Promise<Skill>;
}

export async function updateSkill(
  name: string,
  description: string,
  content: string,
  scope: SkillScope = "global",
  repoId?: string,
): Promise<Skill> {
  const res = await fetch(
    `/api/skills/${encodeURIComponent(name)}${scopeQuery(scope, repoId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, content }),
    },
  );
  if (!res.ok) {
    throw new Error("Failed to update skill");
  }
  return res.json() as Promise<Skill>;
}

export async function deleteSkill(
  name: string,
  scope: SkillScope = "global",
  repoId?: string,
): Promise<void> {
  const res = await fetch(
    `/api/skills/${encodeURIComponent(name)}${scopeQuery(scope, repoId)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error("Failed to delete skill");
  }
}
