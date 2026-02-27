/**
 * ptyStore.ts — In-memory PTY session state and buffer/status helpers.
 *
 * Extracted from pty-manager.ts so the session Map and its associated helper
 * functions can be unit-tested independently of node-pty and WebSocket I/O.
 */

import type { IPty } from "node-pty";
import { WebSocket } from "ws";

import type { SessionRegistryEntry } from "../utils/sessionRegistry";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Rolling output buffer cap per session (500 KB). */
export const BUFFER_CAP = 500 * 1024;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ClaudeStatus =
  | "connecting"
  | "thinking"
  | "typing"
  | "waiting"
  | "exited"
  | "disconnected";

export type SessionEntry = {
  pty: IPty;
  outputBuffer: Buffer[];
  bufferSize: number;
  activeWs: WebSocket | null;
  currentStatus: ClaudeStatus;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

// ─── In-memory session store ──────────────────────────────────────────────────

export const sessions = new Map<string, SessionEntry>();

/**
 * Sessions that have exited naturally (e.g. handover `-p` sessions that
 * completed their task).  wsSessionHandler checks this map before spawning a
 * `--continue` session so it doesn't accidentally resume the caller's own
 * Claude Code session when a user views a completed task's terminal.
 *
 * The stored Buffer is the concatenated final output so it can be replayed
 * to the client — ensuring "Session ended." is never the first visible line.
 */
export const completedSessions = new Map<string, Buffer>();

// ─── Buffer / status helpers ─────────────────────────────────────────────────

export function appendToBuffer(entry: SessionEntry, chunk: Buffer): void {
  entry.outputBuffer.push(chunk);
  entry.bufferSize += chunk.byteLength;
  while (entry.bufferSize > BUFFER_CAP && entry.outputBuffer.length > 1) {
    const removed = entry.outputBuffer.shift()!;
    entry.bufferSize -= removed.byteLength;
  }
}

export function emitStatus(ws: WebSocket | null, status: ClaudeStatus): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "status", value: status }));
  }
}

/**
 * Callback to server.ts to move a task from "Review" back to "In Progress".
 *
 * Called when the user sends input to an active session after the task has
 * already been advanced to Review — e.g. typing "Keep going" in the terminal.
 */
export function backToInProgress(sessionId: string): void {
  const SERVER_PORT = process.env.SERVER_PORT ?? "3000";
  void fetch(
    `http://localhost:${SERVER_PORT}/api/internal/sessions/${sessionId}/back-to-in-progress`,
    { method: "POST" },
  ).catch(() => {
    // server may not be running yet or restarting — safe to swallow
  });
}

/**
 * Callback to server.ts to advance a task to "Review" status.
 *
 * The actual task-mutation logic lives in server.ts (which owns tasks.json
 * and the board WebSocket broadcast).  We call back over HTTP so that
 * pty-manager.ts stays stateless with respect to tasks.
 */
export function advanceToReview(sessionId: string): void {
  const SERVER_PORT = process.env.SERVER_PORT ?? "3000";
  void fetch(
    `http://localhost:${SERVER_PORT}/api/internal/sessions/${sessionId}/advance-to-review`,
    { method: "POST" },
  ).catch(() => {
    // server may not be running yet or restarting — safe to swallow
  });
}

// ─── Kill helper (shared by DELETE and POST /kill) ───────────────────────────

export function killSession(
  id: string,
  sessionRegistry: Map<string, SessionRegistryEntry>,
  saveRegistry: () => Promise<void>,
): void {
  const entry = sessions.get(id);
  if (entry) {
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
    }
    entry.activeWs = null;
    entry.pty.kill();
    sessions.delete(id);
  }
  sessionRegistry.delete(id);
  void saveRegistry();
}
