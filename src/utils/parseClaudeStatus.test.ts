import { parseClaudeStatus } from "./parseClaudeStatus";

// ── helpers ──────────────────────────────────────────────────────────────────
const spinnerChunk = (char = "⣾") => `\r${char} Thinking...`;
const promptChunk = () => `\x1b[?2004h\x1b[32m>\x1b[0m `;
const textChunk = (t: string) => `\x1b[1m${t}\x1b[0m`;

describe("parseClaudeStatus", () => {
  // ── waiting ─────────────────────────────────────────────────────────────
  describe("waiting", () => {
    it("returns 'waiting' when chunk contains bracketed paste ON", () => {
      expect(parseClaudeStatus(promptChunk())).toBe("waiting");
    });

    it("returns 'waiting' even when combined with prior text", () => {
      expect(parseClaudeStatus(`some output\x1b[?2004h`)).toBe("waiting");
    });

    it("waiting takes priority over spinner pattern", () => {
      expect(parseClaudeStatus(`\r⣾ Thinking\x1b[?2004h`)).toBe("waiting");
    });

    it("waiting takes priority over typing-length text", () => {
      expect(parseClaudeStatus(`here is a long response\x1b[?2004h`)).toBe(
        "waiting",
      );
    });

    it("returns 'waiting' for Claude Code v2 ❯ input prompt", () => {
      expect(parseClaudeStatus(`❯ Try "how does <filepath> work?"`)).toBe(
        "waiting",
      );
    });

    it("returns 'waiting' for ❯ prompt with ANSI color prefix", () => {
      expect(
        parseClaudeStatus(`\x1b[32m❯\x1b[0m Try "edit <filepath> to..."`),
      ).toBe("waiting");
    });

    it("❯ prompt takes priority over typing-length hint text", () => {
      // The hint text after ❯ is ≥8 printable chars and would be 'typing'
      // without the ❯ check
      expect(
        parseClaudeStatus(`❯ Try "how does the authentication system work?"`),
      ).toBe("waiting");
    });

    it("❯ prompt with spinner in same chunk returns 'thinking' (active repaint guard)", () => {
      // When ❯ and a spinner appear together it is a full-screen repaint
      // during active processing — the ❯ input area is always visible at the
      // bottom of the terminal.  The spinner wins so we don't false-advance.
      expect(parseClaudeStatus(`\r✻ Thinking...\n❯ `)).toBe("thinking");
    });

    it("❯ prompt without spinner returns 'waiting' (Claude is truly done)", () => {
      expect(parseClaudeStatus(`❯ Try "how does <filepath> work?"`)).toBe(
        "waiting",
      );
    });
  });

  // ── thinking ─────────────────────────────────────────────────────────────
  describe("thinking", () => {
    it("returns 'thinking' for \\r + braille spinner char", () => {
      expect(parseClaudeStatus(spinnerChunk("⣾"))).toBe("thinking");
    });

    it.each([..."⣾⣽⣻⢿⡿⣟⣯⣷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✻✶✢·*"])(
      "returns 'thinking' for spinner char %s",
      (char) => {
        expect(parseClaudeStatus(`\r${char} ok`)).toBe("thinking");
      },
    );

    it("returns 'thinking' when chunk contains (thinking) label", () => {
      // Claude Code v2 renders "(thinking)" as status text during processing
      expect(
        parseClaudeStatus("\x1b[38;2;174;174;174m\x1b[8;13H(thinking)"),
      ).toBe("thinking");
    });

    it("(thinking) takes priority over typing-length text", () => {
      // chunk has >8 printable chars but also contains (thinking)
      expect(
        parseClaudeStatus("\x1b[38;2;176;176;176m\x1b[11C(thinking) more text"),
      ).toBe("thinking");
    });

    it("thinking takes priority over typing-length text", () => {
      // Short spinner chunk — not enough text to be 'typing' on its own
      expect(parseClaudeStatus("\r⣾ ok")).toBe("thinking");
    });

    it("does NOT return 'thinking' for spinner char without \\r", () => {
      // Spinner char in the middle of a sentence is just content, not animation
      const result = parseClaudeStatus(
        "⣾ here is a very long sentence that Claude is typing out",
      );
      expect(result).not.toBe("thinking");
    });
  });

  // ── typing ────────────────────────────────────────────────────────────────
  describe("typing", () => {
    it("returns 'typing' for substantial plain text", () => {
      expect(parseClaudeStatus("Here is the solution to your problem")).toBe(
        "typing",
      );
    });

    it("returns 'typing' when text is wrapped in ANSI formatting", () => {
      expect(
        parseClaudeStatus(textChunk("Here is the answer to your question")),
      ).toBe("typing");
    });

    it("returns null for text shorter than threshold", () => {
      expect(parseClaudeStatus("hi")).toBeNull();
    });

    it("returns null for a chunk that is only ANSI sequences", () => {
      expect(parseClaudeStatus("\x1b[2J\x1b[H\x1b[?25l")).toBeNull();
    });

    it("returns null for whitespace-only content", () => {
      expect(parseClaudeStatus("   \n  \r\n  ")).toBeNull();
    });
  });

  // ── null / edge cases ─────────────────────────────────────────────────────
  describe("null cases", () => {
    it("returns null for empty string", () => {
      expect(parseClaudeStatus("")).toBeNull();
    });

    it("returns null for cursor-movement-only ANSI", () => {
      expect(parseClaudeStatus("\x1b[?25h\x1b[H")).toBeNull();
    });
  });
});

describe("real Claude CLI output regression fixtures", () => {
  // Frozen captures from actual Claude CLI output sequences.
  // These prevent silent breakage when Claude CLI updates its rendering.
  // If any of these fail after a Claude CLI upgrade, update the fixture
  // AND verify the detector still works correctly with the new format.

  it("Claude startup spinner (within echo window) returns 'thinking'", () => {
    // Captured from Claude Code startup before the first prompt appears.
    // The spinner rotates through braille chars while Claude initializes.
    const startupSpinnerChunk = "\r⣾ Loading...";
    expect(parseClaudeStatus(startupSpinnerChunk)).toBe("thinking");
  });

  it("Claude v2 (thinking) label returns 'thinking'", () => {
    // Captured from Claude Code v2 during extended thinking mode.
    // The (thinking) label appears with ANSI positioning and color.
    const thinkingLabelChunk = "\x1b[38;2;174;174;174m\x1b[8;13H(thinking)";
    expect(parseClaudeStatus(thinkingLabelChunk)).toBe("thinking");
  });

  it("prompt chunk with hint text (v2.1.58+) returns 'waiting'", () => {
    // Captured from Claude Code v2.1.58+ which dropped the bracketed-paste
    // escape sequence. The unicode prompt character is the primary
    // waiting-state detector for these newer versions.
    const v2PromptChunk = `❯ Try "how does <filepath> work?"`;
    expect(parseClaudeStatus(v2PromptChunk)).toBe("waiting");
  });

  it("tool result prefix chunk returns 'typing'", () => {
    // Captured from Claude Code tool result output.
    // The prefix indicates a completed tool call. parseClaudeStatus treats
    // this as plain content because activity detection via that character
    // happens in ptyHandlers, not here. The string is long enough to cross
    // the typing threshold.
    const toolResultChunk = "  Read 42 lines from src/utils/parser.ts";
    expect(parseClaudeStatus(toolResultChunk)).toBe("typing");
  });

  it("full-screen repaint with both prompt and spinner returns 'thinking'", () => {
    // Captured during active Claude processing: a full-screen repaint
    // includes the spinner at the top and the input area at the bottom of
    // the same buffer flush. The spinner must take priority so the handover
    // logic does not false-advance to the waiting state.
    const fullRepaintChunk = `\r✻ Thinking...\n❯ `;
    expect(parseClaudeStatus(fullRepaintChunk)).toBe("thinking");
  });
});
