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
