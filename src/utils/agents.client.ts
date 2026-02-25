// src/utils/agents.client.ts

export type AgentScope = "global" | "repo";

export interface Agent {
  name: string;
  description: string;
  content: string;
}

function scopeQuery(scope: AgentScope, repoId?: string): string {
  if (scope === "repo" && repoId) {
    return `?scope=repo&repoId=${encodeURIComponent(repoId)}`;
  }
  return "";
}

export async function fetchAgents(
  scope: AgentScope = "global",
  repoId?: string,
): Promise<{ name: string; description: string }[]> {
  const res = await fetch(`/api/agents${scopeQuery(scope, repoId)}`);
  if (!res.ok) { throw new Error("Failed to fetch agents"); }
  const data = (await res.json()) as {
    agents: { name: string; description: string }[];
  };
  return data.agents;
}

export async function fetchAgent(
  name: string,
  scope: AgentScope = "global",
  repoId?: string,
): Promise<Agent> {
  const res = await fetch(
    `/api/agents/${encodeURIComponent(name)}${scopeQuery(scope, repoId)}`,
  );
  if (!res.ok) { throw new Error(`Failed to fetch agent: ${name}`); }
  return res.json() as Promise<Agent>;
}

export async function createAgent(
  name: string,
  description: string,
  content: string,
  scope: AgentScope = "global",
  repoId?: string,
): Promise<Agent> {
  const res = await fetch(`/api/agents${scopeQuery(scope, repoId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, content }),
  });
  if (!res.ok) { throw new Error("Failed to create agent"); }
  return res.json() as Promise<Agent>;
}

export async function updateAgent(
  name: string,
  description: string,
  content: string,
  scope: AgentScope = "global",
  repoId?: string,
): Promise<Agent> {
  const res = await fetch(
    `/api/agents/${encodeURIComponent(name)}${scopeQuery(scope, repoId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, content }),
    },
  );
  if (!res.ok) { throw new Error("Failed to update agent"); }
  return res.json() as Promise<Agent>;
}

export async function deleteAgent(
  name: string,
  scope: AgentScope = "global",
  repoId?: string,
): Promise<void> {
  const res = await fetch(
    `/api/agents/${encodeURIComponent(name)}${scopeQuery(scope, repoId)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) { throw new Error("Failed to delete agent"); }
}
