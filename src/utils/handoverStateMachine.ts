import { parseClaudeStatus, type ParsedStatus } from "./parseClaudeStatus";

/**
 * Milliseconds after spec injection during which spinner detection is
 * suppressed.  Avoids false-positive "meaningful activity" from Claude Code's
 * startup splash, which can include spinner-like characters.
 *
 * ⎿ detection is intentionally NOT gated by this window because ⎿ never
 * appears in the startup splash.
 *
 * 3 000 ms: Claude Code startup on Windows (node-pty + claude.cmd) routinely
 * takes 1–2 s, so 500 ms was too short and let the startup spinner fire within
 * the window, causing every task to be immediately advanced to Review.
 *
 * Must stay in sync with SPEC_ECHO_WINDOW_MS in ptyStore.ts.
 */
export const SPEC_ECHO_WINDOW_MS = 3000;

// ─── State ────────────────────────────────────────────────────────────────────

export interface HandoverState {
  /**
   * "waiting_for_prompt" — Claude REPL has not yet shown the ❯ prompt;
   *   spec has NOT been written to the PTY yet.
   * "spec_sent" — spec injected, waiting for Claude to finish.
   * "done" — task advanced to Review.
   */
  phase: "waiting_for_prompt" | "spec_sent" | "done";
  /**
   * True once we have seen a ⎿ prefix or a thinking spinner (past the echo
   * window).  Guards the fast-path so startup noise never advances the task.
   */
  hadMeaningfulActivity: boolean;
  /**
   * Last non-null status from parseClaudeStatus.  Distinguishes tool-use
   * silences (last=thinking) from response-complete silences (last=typing)
   * so the idle-timeout path only advances on a real response.
   */
  lastMeaningfulStatus: ParsedStatus | null;
  /** Date.now() value at the moment the spec was sent to the PTY. */
  specSentAt: number;
}

/**
 * State before the spec is injected — waiting for Claude's ❯ prompt.
 * specSentAt is 0 here; it will be stamped when the spec is actually written.
 */
export function makeInitialHandoverState(): HandoverState {
  return {
    phase: "waiting_for_prompt",
    hadMeaningfulActivity: false,
    lastMeaningfulStatus: null,
    specSentAt: 0,
  };
}

/**
 * State after the spec has been injected into the PTY.
 * Used by callers that need to advance from "waiting_for_prompt" to "spec_sent".
 */
export function makeSpecSentState(specSentAt: number): HandoverState {
  return {
    phase: "spec_sent",
    hadMeaningfulActivity: false,
    lastMeaningfulStatus: null,
    specSentAt,
  };
}

// ─── Chunk processing ─────────────────────────────────────────────────────────

export interface HandoverChunkResult {
  /** Updated state (input state is never mutated). */
  state: HandoverState;
  /**
   * Non-null when the chunk changes the inferred Claude status.
   * Caller should emit this to connected WebSocket clients.
   */
  statusEmit: ParsedStatus | null;
  /**
   * True when the caller should write the spec to the PTY using bracketed
   * paste.  Only fires once, on the first ❯ prompt in waiting_for_prompt phase.
   */
  injectSpec: boolean;
  /** True when the state machine has decided to advance the task to Review. */
  advanceToReview: boolean;
}

/**
 * Process one raw PTY data chunk through the handover state machine.
 *
 * Pure function — no side effects, no timers, no network calls.
 *
 * @param state  Current state (not mutated).
 * @param data   Raw PTY output string.
 * @param nowMs  Current timestamp in ms (injectable for testing; defaults to Date.now()).
 */
export function processHandoverChunk(
  state: HandoverState,
  data: string,
  nowMs: number = Date.now(),
): HandoverChunkResult {
  // Once the task is done, ignore all future chunks.
  if (state.phase === "done") {
    return {
      state,
      statusEmit: null,
      injectSpec: false,
      advanceToReview: false,
    };
  }

  const parsed = parseClaudeStatus(data);
  const lastMeaningfulStatus =
    parsed !== null ? parsed : state.lastMeaningfulStatus;

  // ── Phase 1: waiting for the first ❯ prompt so we can inject the spec ───────
  if (state.phase === "waiting_for_prompt") {
    if (parsed === "waiting") {
      // Claude REPL is ready.  Signal the caller to write the spec to the PTY.
      // Transition to spec_sent, stamping specSentAt = nowMs.
      return {
        state: makeSpecSentState(nowMs),
        statusEmit: parsed,
        injectSpec: true,
        advanceToReview: false,
      };
    }
    // Not ready yet — buffer output but take no action.
    return {
      state: { ...state, lastMeaningfulStatus },
      statusEmit: parsed,
      injectSpec: false,
      advanceToReview: false,
    };
  }

  // ── Phase 2: spec sent, waiting for Claude to finish processing ──────────────
  let hadMeaningfulActivity = state.hadMeaningfulActivity;

  // ⎿ prefix (tool results, "Interrupted" message, etc.) never appears in the
  // startup splash, so it is a safe meaningful-activity signal with NO time
  // gate — even if the interrupt fires within the first 500 ms we must honour it.
  if (!hadMeaningfulActivity && data.includes("⎿")) {
    hadMeaningfulActivity = true;
  }

  // Thinking spinner: gate behind SPEC_ECHO_WINDOW_MS because spinner chars
  // can appear in startup noise before Claude actually processes the spec.
  if (
    !hadMeaningfulActivity &&
    parsed === "thinking" &&
    nowMs - state.specSentAt > SPEC_ECHO_WINDOW_MS
  ) {
    hadMeaningfulActivity = true;
  }

  // Fast path: ❯ prompt detected + meaningful activity = task is done.
  // Advance to Review immediately without waiting for the idle timer.
  if (parsed === "waiting" && hadMeaningfulActivity) {
    return {
      state: {
        ...state,
        phase: "done",
        hadMeaningfulActivity,
        lastMeaningfulStatus,
      },
      statusEmit: parsed,
      injectSpec: false,
      advanceToReview: true,
    };
  }

  return {
    state: { ...state, hadMeaningfulActivity, lastMeaningfulStatus },
    statusEmit: parsed,
    injectSpec: false,
    advanceToReview: false,
  };
}

// ─── Idle-timeout processing ──────────────────────────────────────────────────

export interface HandoverIdleResult {
  /** Updated state (input state is never mutated). */
  state: HandoverState;
  /** True when the state machine has decided to advance the task to Review. */
  advanceToReview: boolean;
}

/**
 * Process the idle-timeout event through the handover state machine.
 *
 * Called after SESSION_IDLE_MS of PTY silence.  Advances to Review only when
 * the last observed status was "typing" — a tool-use gap (thinking → silence)
 * should NOT advance the task.
 *
 * Pure function — no side effects, no timers, no network calls.
 */
export function processHandoverIdle(state: HandoverState): HandoverIdleResult {
  if (state.phase !== "spec_sent") {
    return { state, advanceToReview: false };
  }
  if (state.hadMeaningfulActivity && state.lastMeaningfulStatus === "typing") {
    return { state: { ...state, phase: "done" }, advanceToReview: true };
  }
  return { state, advanceToReview: false };
}
