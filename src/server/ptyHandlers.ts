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

    // Phase 1 → Phase 2: Claude REPL is ready — inject the spec.
    // Bracketed paste (ESC[200~ … ESC[201~) tells readline to accept
    // embedded newlines without treating each one as a submission, so
    // the entire multiline spec arrives as a single message.
    if (e.handoverPhase === "waiting_for_prompt" && parsed === "waiting") {
      e.pty.write(`\x1b[200~${e.handoverSpec}\x1b[201~\r`);
      e.handoverPhase = "spec_sent";
      e.specSentAt = Date.now();
      e.hadMeaningfulActivity = false;
      return;
    }

    // ⎿ prefix (tool results, "Interrupted" message, etc.) never appears in
    // the startup splash, so it is a safe meaningful-activity signal with NO
    // time gate — even if the interrupt fires within the first 500 ms we must
    // honour it.
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

    // Fast path: ❯ prompt detected = Claude is done (task complete or
    // question asked). Advance to Review immediately without waiting for
    // the idle timer to fire.
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

    // Fallback: schedule waiting detection after PTY silence
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
    sessions.delete(sessionId);

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
    const e = sessions.get(sessionId)!;
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
