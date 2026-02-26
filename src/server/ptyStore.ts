/**
 * ptyStore.ts — In-memory PTY session state and buffer/status helpers.
 *
 * Extracted from pty-manager.ts so the session Map and its associated helper
 * functions can be unit-tested independently of node-pty and WebSocket I/O.
 */

import type { IPty } from "node-pty";
import { WebSocket } from "ws";

import type { ParsedStatus } from "../utils/parseClaudeStatus";
import type { SessionRegistryEntry } from "../utils/sessionRegistry";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Rolling output buffer cap per session (500 KB). */
export const BUFFER_CAP = 500 * 1024;

/**
 * Window after writing the spec to the PTY during which output is treated as
 * echo/startup noise rather than meaningful Claude activity.
 *
 * 3 000 ms: Claude Code startup on Windows (node-pty + claude.cmd) routinely
 * takes 1–2 s, so 500 ms was too short and let the startup spinner fire within
 * the window, causing every task to be immediately advanced to Review.
 */
export const SPEC_ECHO_WINDOW_MS = 3000;

/**
 * How long the PTY must be silent before we treat it as "waiting for input".
 * Must be longer than Claude's longest internal API-call pause (~3 s observed).
 */
export const SESSION_IDLE_MS = 5000;

// ─── Types ───────────────────────────────────────────────────────────────────

export type ClaudeStatus =
  | "connecting"
  | "thinking"
  | "typing"
  | "waiting"
  | "exited"
  | "disconnected";

// "waiting_for_prompt" → Claude REPL has not yet shown the ❯ prompt;
// "spec_sent"          → spec has been injected, waiting for Claude to finish;
// "done"               → task advanced to Review.
export type HandoverPhase = "waiting_for_prompt" | "spec_sent" | "done";

export type SessionEntry = {
  pty: IPty;
  outputBuffer: Buffer[];
  bufferSize: number;
  activeWs: WebSocket | null;
  currentStatus: ClaudeStatus;
  idleTimer: ReturnType<typeof setTimeout> | null;
  // null for non-handover sessions
  handoverPhase: HandoverPhase | null;
  handoverSpec: string;
  specSentAt: number;
  hadMeaningfulActivity: boolean;
  /** Last non-null status from parseClaudeStatus. Used to distinguish
   *  tool-use silences (last=thinking) from response-complete silences
   *  (last=typing) so advanceToReview only fires after a real response. */
  lastMeaningfulStatus: ParsedStatus | null;
  /**
   * True when the PTY output has included the bracketed-paste-on sequence
   * (\x1b[?2004h).  Older Claude Code emits this before the ❯ prompt; newer
   * versions (v2.1.58+) do not.  Used by spec injection to decide whether to
   * wrap the spec in bracketed-paste markers.
   */
  supportsBracketedPaste: boolean;
};

// ─── In-memory session store ──────────────────────────────────────────────────

export const sessions = new Map<string, SessionEntry>();

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
 * Schedule a "waiting" status transition after PTY silence.
 *
 * Called on every onData chunk. Resets the timer so it only fires after
 * SESSION_IDLE_MS ms of continuous silence — long enough to outlast
 * Claude's internal API-call pauses while still detecting when Claude
 * actually returns to its input prompt.
 */
export function scheduleIdleStatus(
  entry: SessionEntry,
  sessionId: string,
): void {
  if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer);
  }
  entry.idleTimer = setTimeout(() => {
    const e = sessions.get(sessionId);
    if (!e) {
      return;
    }
    e.idleTimer = null;
    if (e.currentStatus !== "waiting") {
      e.currentStatus = "waiting";
      emitStatus(e.activeWs, "waiting");
    }
    // Only advance when:
    //  - hadMeaningfulActivity: we saw the thinking spinner (Claude actually
    //    processed the spec), guarding against startup splash text that also
    //    looks like typing
    //  - lastMeaningfulStatus === "typing": silence followed streamed response,
    //    not a tool-use gap (thinking → silence = bash/file/API still running)
    if (
      e.handoverPhase === "spec_sent" &&
      e.hadMeaningfulActivity &&
      e.lastMeaningfulStatus === "typing"
    ) {
      e.handoverPhase = "done";
      advanceToReview(sessionId);
    }
  }, SESSION_IDLE_MS);
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
