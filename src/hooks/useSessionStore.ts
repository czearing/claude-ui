"use client";

import { useEffect, useState } from "react";

export type Session = {
  id: string;
  name: string;
  createdAt: string;
};

const STORAGE_KEY = "claude-sessions";

function loadSessions(): Session[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function nextInstanceName(sessions: Session[]): string {
  const count = sessions.length + 1;
  return `Instance ${count}`;
}

export function useSessionStore() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    setSessions(loadSessions());
  }, []);

  function addSession(): Session {
    const current = loadSessions();
    const session: Session = {
      id: crypto.randomUUID(),
      name: nextInstanceName(current),
      createdAt: new Date().toISOString(),
    };
    const updated = [...current, session];
    saveSessions(updated);
    setSessions(updated);
    return session;
  }

  async function deleteSession(id: string): Promise<void> {
    try {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    } catch {
      // best effort — remove from local store regardless
    }
    const current = loadSessions();
    const updated = current.filter((s) => s.id !== id);
    saveSessions(updated);
    setSessions(updated);
  }

  return { sessions, addSession, deleteSession };
}
