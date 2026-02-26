/**
 * ptyHandlers.ts — PTY event handler attachment.
 *
 * Exports `attachHandoverHandlers` and `attachTerminalHandlers`, which wire
 * up the `onData` and `onExit` callbacks for handover and terminal sessions
 * respectively.
 */

import type * as pty from "node-pty";
import { WebSocket } from "ws";

import {
  advanceToReview,
  appendToBuffer,
  completedSessions,
  emitStatus,
  scheduleIdleStatus,
  sessions,
  SPEC_ECHO_WINDOW_MS,
} from "./ptyStore";
import { parseClaudeStatus } from "../utils/parseClaudeStatus";

/**
 * Attach the standard onData / onExit handlers to a handover PTY process.
 *
 * Handles the three-phase handover state machine:
 *   waiting_for_prompt → spec_sent → done
 */
export function attachHandoverHandlers(
  ptyProcess: pty.IPty,
  sessionId: string,
): void {
  ptyProcess.onData((data) => {
    const chunk = Buffer.from(data);
    const e = sessions.get(sessionId);
    if (!e) {
      return;
    }

    appendToBuffer(e, chunk);
    if (e.activeWs?.readyState === WebSocket.OPEN) {
      e.activeWs.send(chunk);
    }

    const parsed = parseClaudeStatus(data);
    if (parsed !== null) {
      e.lastMeaningfulStatus = parsed;
      if (parsed !== e.currentStatus) {
        e.currentStatus = parsed;
        emitStatus(e.activeWs, parsed);
      }
    }

    // Track bracketed-paste support via the \x1b[?2004h sequence.
    if (!e.supportsBracketedPaste && data.includes("\x1b[?2004h")) {
      e.supportsBracketedPaste = true;
    }

    // Phase 1 → Phase 2: inject spec on the first ❯ prompt.
    // Use bracketed paste only when the PTY has advertised support
    // (\x1b[?2004h seen).  Claude Code v2.1.58+ omits that sequence,
    // so fall back to plain spec + \r which works on all versions.
    if (e.handoverPhase === "waiting_for_prompt" && parsed === "waiting") {
      if (e.supportsBracketedPaste) {
        // Bracketed paste preserves newlines literally (they won't trigger
        // early submission inside \x1b[200~...\x1b[201~).  Use \r\n after
        // the closing marker so Enter registers on Windows ConPTY.
        e.pty.write(`\x1b[200~${e.handoverSpec}\x1b[201~\r\n`);
      } else {
        // Without bracketed paste, \n would be treated as Enter and submit
        // the command prematurely — collapse to spaces.  Use \r\n for Enter
        // so Windows ConPTY registers the submission (bare \r is not enough).
        const spec = e.handoverSpec.replace(/\n/g, " ");
        e.pty.write(`${spec}\r\n`);
      }
      e.handoverPhase = "spec_sent";
      e.specSentAt = Date.now();
      e.hadMeaningfulActivity = false;
      return;
    }

    // ⎿ prefix (tool results, "Interrupted") never appears in startup splash —
    // safe meaningful-activity signal with no time gate.
    if (
      e.handoverPhase === "spec_sent" &&
      !e.hadMeaningfulActivity &&
      data.includes("⎿")
    ) {
      e.hadMeaningfulActivity = true;
    }

    // Thinking spinner: gate behind SPEC_ECHO_WINDOW_MS because spinner chars
    // can appear in startup noise before Claude actually processes the spec.
    if (
      e.handoverPhase === "spec_sent" &&
      !e.hadMeaningfulActivity &&
      parsed === "thinking" &&
      Date.now() - e.specSentAt > SPEC_ECHO_WINDOW_MS
    ) {
      e.hadMeaningfulActivity = true;
    }

    // Fast path: ❯ prompt + meaningful activity = task done.
    // Advance to Review without waiting for the idle timer.
    if (
      parsed === "waiting" &&
      e.handoverPhase === "spec_sent" &&
      e.hadMeaningfulActivity
    ) {
      if (e.idleTimer !== null) {
        clearTimeout(e.idleTimer);
        e.idleTimer = null;
      }
      e.handoverPhase = "done";
      advanceToReview(sessionId);
      return;
    }

    scheduleIdleStatus(e, sessionId);
  });

  ptyProcess.onExit(({ exitCode }) => {
    const e = sessions.get(sessionId);
    // Use explicit undefined check: `undefined !== null` would
    // spuriously set isHandover=true when the session was already
    // removed (e.g. by recall before the process exited).
    const isHandover = e !== undefined && e.handoverPhase !== null;
    const wasHandoverDone = e?.handoverPhase === "done";
    if (e) {
      if (e.idleTimer !== null) {
        clearTimeout(e.idleTimer);
      }
      e.currentStatus = "exited";
      if (e.activeWs?.readyState === WebSocket.OPEN) {
        e.activeWs.send(JSON.stringify({ type: "exit", code: exitCode }));
        e.activeWs.close();
      }
    }
    // Capture final output before removing the session so wsSessionHandler
    // can replay it when the user views the terminal after the session exits.
    const finalBuffer = e ? Buffer.concat(e.outputBuffer) : Buffer.alloc(0);
    sessions.delete(sessionId);
    // Mark as completed so wsSessionHandler won't spawn a --continue session
    // when the user views this session's terminal after it has already exited.
    completedSessions.set(sessionId, finalBuffer);

    // Fallback: if the process exits before the state machine could
    // advance to Review (e.g. Claude crashed), do it now.
    if (isHandover && !wasHandoverDone) {
      advanceToReview(sessionId);
    }
  });
}

/**
 * Attach the standard onData / onExit handlers to a terminal-session PTY
 * process (non-handover: fresh or --continue sessions).
 */
export function attachTerminalHandlers(
  ptyProcess: pty.IPty,
  sessionId: string,
): void {
  ptyProcess.onData((data) => {
    const chunk = Buffer.from(data);
    const e = sessions.get(sessionId);
    if (!e) {
      return;
    }
    appendToBuffer(e, chunk);
    if (e.activeWs?.readyState === WebSocket.OPEN) {
      e.activeWs.send(chunk);
    }

    const parsed = parseClaudeStatus(data);
    if (parsed !== null) {
      e.lastMeaningfulStatus = parsed;
      if (parsed !== e.currentStatus) {
        e.currentStatus = parsed;
        emitStatus(e.activeWs, parsed);
      }
    }

    // Track meaningful activity: ⎿ prefix ONLY (tool results, "Interrupted"
    // message). Spinners are NOT used here because terminal sessions have no
    // spec-injection timestamp to gate against — the startup spinner from
    // `claude --continue` would fire immediately and cause false advances.
    // ⎿ never appears in the startup splash, making it a safe ungated signal.
    if (!e.hadMeaningfulActivity && data.includes("⎿")) {
      e.hadMeaningfulActivity = true;
    }

    // Fast path for recalled sessions: ❯ prompt + meaningful activity
    // means the task needs user attention — advance to Review if it is
    // still "In Progress". advanceToReview checks status before moving.
    if (parsed === "waiting" && e.hadMeaningfulActivity) {
      void advanceToReview(sessionId);
    }

    scheduleIdleStatus(e, sessionId);
  });

  ptyProcess.onExit(({ exitCode }) => {
    const e = sessions.get(sessionId);
    if (e) {
      if (e.idleTimer !== null) {
        clearTimeout(e.idleTimer);
      }
      e.currentStatus = "exited";
      if (e.activeWs?.readyState === WebSocket.OPEN) {
        e.activeWs.send(JSON.stringify({ type: "exit", code: exitCode }));
        e.activeWs.close();
      }
    }
    sessions.delete(sessionId);
  });
}
