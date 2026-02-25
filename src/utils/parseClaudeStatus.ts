/** Subset of ClaudeStatus values that onData can infer from a single chunk. */
export type ParsedStatus = "thinking" | "typing" | "waiting";

/**
 * Bracketed paste mode ON (\x1b[?2004h).
 * Readline / Ink sends this sequence immediately before rendering the input
 * prompt, making it a reliable synchronous "ready for input" signal.
 */
const BRACKETED_PASTE_ON = "\x1b[?2004h";

/**
 * Claude Code v2 input prompt character (U+276F HEAVY RIGHT-POINTING ANGLE
 * QUOTATION MARK) followed by a space. This is the ❯ glyph that Claude Code
 * renders at the start of its interactive input line — distinct from the ASCII
 * greater-than sign (U+003E) used in prose. Detecting it here gives us a fast,
 * synchronous "waiting for input" signal that works in v2.1.58+ where
 * \x1b[?2004h is not emitted.
 */
const INPUT_PROMPT_CHAR = "❯";

/**
 * Spinner animation pattern: carriage return (no newline) followed by a
 * spinner character. This is how CLI spinners redraw in-place without
 * scrolling the terminal.
 *
 * Includes:
 *  - Braille dots  (ora / cli-spinners classic set)
 *  - ✻ ✶ ✢ · *    (Claude Code v2 custom spinner set)
 */
const SPINNER_RE = /\r[⣾⣽⣻⢿⡿⣟⣯⣷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✻✶✢·*]/;

/**
 * Claude Code v2 renders "(thinking)" as status text alongside the spinner
 * while Claude is processing. This is a reliable thinking signal that is
 * absent once Claude starts streaming its response.
 */
const THINKING_TEXT = "(thinking)";

/**
 * Matches all standard ANSI / VT100 escape sequences so we can strip them
 * before counting printable characters.
 *
 * Covers:
 *  - CSI sequences   \x1b[…m  (colours, cursor movement, etc.)
 *  - OSC sequences   \x1b]…\x07 or \x1b\  (title, hyperlinks)
 *  - Two-byte ESC    \x1b + one char  (Fe, Fp sequences)
 */
/* eslint-disable no-control-regex */
const ANSI_RE =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])/g;
/* eslint-enable no-control-regex */

/** Minimum non-whitespace characters after stripping ANSI to count as typing. */
const TYPING_THRESHOLD = 8;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/**
 * Infer Claude's status from a single raw PTY output chunk.
 *
 * Returns null when the chunk is too short or ambiguous to change the
 * current status — callers should keep the previous status in that case.
 *
 * Priority: waiting > thinking > typing > null
 */
export function parseClaudeStatus(chunk: string): ParsedStatus | null {
  // 1a. Bracketed paste ON = input prompt rendered = waiting for user
  if (chunk.includes(BRACKETED_PASTE_ON)) {
    return "waiting";
  }

  // 1b. Claude Code v2 ❯ input prompt character = waiting for user input.
  //     Takes priority over typing because the hint text after ❯ is ≥8 chars
  //     and would otherwise be mis-classified as "typing".
  //
  //     GUARD: if the same chunk also contains a spinner pattern or "(thinking)",
  //     this is a full-screen repaint during active processing — Claude Code
  //     always renders the ❯ input area at the bottom of the terminal, so it
  //     appears in re-render chunks even while Claude is working.  Only treat
  //     ❯ as "waiting" when there are no active-work indicators in the chunk.
  if (
    chunk.includes(INPUT_PROMPT_CHAR) &&
    !SPINNER_RE.test(chunk) &&
    !chunk.includes(THINKING_TEXT)
  ) {
    return "waiting";
  }

  // 2. Claude Code v2 "(thinking)" status label — highest-priority thinking signal
  if (chunk.includes(THINKING_TEXT)) {
    return "thinking";
  }

  // 3. Spinner + carriage-return = processing animation
  if (SPINNER_RE.test(chunk)) {
    return "thinking";
  }

  // 4. Substantial printable text = Claude is streaming its response
  const printable = stripAnsi(chunk).replace(/\s/g, "");
  if (printable.length >= TYPING_THRESHOLD) {
    return "typing";
  }

  return null;
}
