import { parseClaudeStatus, type ParsedStatus } from "./parseClaudeStatus";

/**
 * Milliseconds after spec injection during which spinner detection is
 * suppressed.  Avoids false-positive "meaningful activity" from Claude Code's
 * startup splash, which can include spinner-like characters.
 *
 * ⎿ detection is intentionally NOT gated by this window because ⎿ never
 * appears in the startup splash.
 */
export const SPEC_ECHO_WINDOW_MS = 500;

// ─── State ────────────────────────────────────────────────────────────────────

export interface HandoverState {
  /** "spec_sent" until the task advances to Review; "done" thereafter. */
  phase: "spec_sent" | "done";
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

export function makeInitialHandoverState(specSentAt: number): HandoverState {
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
    return { state, statusEmit: null, advanceToReview: false };
  }

  const parsed = parseClaudeStatus(data);
  const lastMeaningfulStatus =
    parsed !== null ? parsed : state.lastMeaningfulStatus;

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
      advanceToReview: true,
    };
  }

  return {
    state: { ...state, hadMeaningfulActivity, lastMeaningfulStatus },
    statusEmit: parsed,
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
