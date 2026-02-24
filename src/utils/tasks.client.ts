import type { Task } from './tasks.types';

async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function getTasks(): Promise<Task[]> {
  return fetchJson<Task[]>('/api/tasks');
}

export async function createTask(data: {
  title: string;
  description?: string;
}): Promise<Task> {
  return fetchJson<Task>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function patchTask(
  id: string,
  data: Partial<Task>,
): Promise<Task> {
  return fetchJson<Task>(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Delete failed: ${res.status} ${res.statusText}`);
  }
}

export async function getTaskLog(id: string): Promise<string> {
  const res = await fetch(`/api/tasks/${id}/log`);
  if (!res.ok) {
    throw new Error(`Log fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}
