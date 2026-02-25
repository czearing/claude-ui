// src/utils/playbooks.client.ts

export interface Playbook {
  name: string;
  content: string;
}

export async function fetchPlaybooks(): Promise<{ name: string }[]> {
  const res = await fetch("/api/skills");
  if (!res.ok) throw new Error("Failed to fetch playbooks");
  const data = (await res.json()) as { skills: { name: string }[] };
  return data.skills;
}

export async function fetchPlaybook(name: string): Promise<Playbook> {
  const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to fetch playbook: ${name}`);
  return res.json() as Promise<Playbook>;
}

export async function createPlaybook(
  name: string,
  content: string,
): Promise<Playbook> {
  const res = await fetch("/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, content }),
  });
  if (!res.ok) throw new Error("Failed to create playbook");
  return res.json() as Promise<Playbook>;
}

export async function updatePlaybook(
  name: string,
  content: string,
): Promise<Playbook> {
  const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to update playbook");
  return res.json() as Promise<Playbook>;
}

export async function deletePlaybook(name: string): Promise<void> {
  const res = await fetch(`/api/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404)
    throw new Error("Failed to delete playbook");
}
