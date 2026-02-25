import {
  makeInitialHandoverState,
  processHandoverChunk,
  processHandoverIdle,
  SPEC_ECHO_WINDOW_MS,
  type HandoverState,
} from "./handoverStateMachine";

// ── helpers ───────────────────────────────────────────────────────────────────

const BASE_TIME = 1_000_000;
const AFTER_WINDOW = BASE_TIME + SPEC_ECHO_WINDOW_MS + 1;
const WITHIN_WINDOW = BASE_TIME + 100;

function freshState(overrides: Partial<HandoverState> = {}): HandoverState {
  return { ...makeInitialHandoverState(BASE_TIME), ...overrides };
}

// ─── processHandoverChunk ────────────────────────────────────────────────────

describe("processHandoverChunk", () => {
  // ── idempotency once done ──────────────────────────────────────────────────

  it("returns the same state reference and no actions when phase is already done", () => {
    const done = freshState({ phase: "done", hadMeaningfulActivity: true });
    const result = processHandoverChunk(done, '❯ Try "edit …"', AFTER_WINDOW);
    expect(result.state).toBe(done);
    expect(result.advanceToReview).toBe(false);
    expect(result.statusEmit).toBeNull();
  });

  // ── ⎿ meaningful-activity detection ───────────────────────────────────────

  describe("⎿ sets hadMeaningfulActivity regardless of timing", () => {
    it("fires within the 500 ms echo window", () => {
      const { state } = processHandoverChunk(
        freshState(),
        "  ⎿  Interrupted · What should Claude do instead?",
        WITHIN_WINDOW,
      );
      expect(state.hadMeaningfulActivity).toBe(true);
    });

    it("fires at t+1 ms — almost immediate interrupt", () => {
      const { state } = processHandoverChunk(
        freshState(),
        "⎿ tool result here",
        BASE_TIME + 1,
      );
      expect(state.hadMeaningfulActivity).toBe(true);
    });

    it("fires after the echo window too", () => {
      const { state } = processHandoverChunk(
        freshState(),
        "⎿ normal tool use",
        AFTER_WINDOW,
      );
      expect(state.hadMeaningfulActivity).toBe(true);
    });
  });

  // ── spinner meaningful-activity detection ──────────────────────────────────

  describe("spinner sets hadMeaningfulActivity only after echo window", () => {
    it("fires after the echo window has elapsed", () => {
      const { state } = processHandoverChunk(
        freshState(),
        "\r⣾ Thinking...",
        AFTER_WINDOW,
      );
      expect(state.hadMeaningfulActivity).toBe(true);
    });

    it("does NOT fire within the echo window", () => {
      const { state } = processHandoverChunk(
        freshState(),
        "\r⣾ Thinking...",
        WITHIN_WINDOW,
      );
      expect(state.hadMeaningfulActivity).toBe(false);
    });

    it("does NOT fire at exactly the window boundary (> not >=)", () => {
      const { state } = processHandoverChunk(
        freshState(),
        "\r⣾ Thinking...",
        BASE_TIME + SPEC_ECHO_WINDOW_MS, // exactly at boundary, not after
      );
      expect(state.hadMeaningfulActivity).toBe(false);
    });
  });

  // ── fast-path advance to Review ────────────────────────────────────────────

  describe("❯ prompt fast-path", () => {
    it("advances when hadMeaningfulActivity is already true", () => {
      const result = processHandoverChunk(
        freshState({ hadMeaningfulActivity: true }),
        '❯ Try "edit <filepath> to..."',
        AFTER_WINDOW,
      );
      expect(result.advanceToReview).toBe(true);
      expect(result.state.phase).toBe("done");
      expect(result.statusEmit).toBe("waiting");
    });

    it("does NOT advance when hadMeaningfulActivity is false", () => {
      const result = processHandoverChunk(
        freshState({ hadMeaningfulActivity: false }),
        '❯ Try "edit <filepath> to..."',
        WITHIN_WINDOW,
      );
      expect(result.advanceToReview).toBe(false);
      expect(result.state.phase).toBe("spec_sent");
    });

    it("advances when ⎿ and ❯ arrive in the SAME chunk within 500 ms — the regression case", () => {
      // Bug: interrupt fires within SPEC_ECHO_WINDOW_MS. The ⎿ signal was
      // previously silenced by the time gate, so hadMeaningfulActivity stayed
      // false and the ❯ fast-path never fired.
      const singleChunk =
        "  ⎿  Interrupted · What should Claude do instead?\r\n\r\n" +
        '❯ Try "edit <filepath> to..."';

      const result = processHandoverChunk(
        freshState(), // hadMeaningfulActivity starts false
        singleChunk,
        WITHIN_WINDOW, // within 500 ms echo window
      );

      expect(result.state.hadMeaningfulActivity).toBe(true);
      expect(result.advanceToReview).toBe(true);
      expect(result.state.phase).toBe("done");
    });

    it("advances across two sequential chunks: ⎿ first, then ❯", () => {
      const r1 = processHandoverChunk(
        freshState(),
        "  ⎿  Interrupted · What should Claude do instead?",
        WITHIN_WINDOW,
      );
      expect(r1.advanceToReview).toBe(false);
      expect(r1.state.hadMeaningfulActivity).toBe(true);

      const r2 = processHandoverChunk(
        r1.state,
        '❯ Try "edit <filepath> to..."',
        WITHIN_WINDOW + 50,
      );
      expect(r2.advanceToReview).toBe(true);
      expect(r2.state.phase).toBe("done");
    });

    it("advances across two sequential chunks: spinner first (after window), then ❯", () => {
      const r1 = processHandoverChunk(
        freshState(),
        "\r✻ Thinking...",
        AFTER_WINDOW,
      );
      expect(r1.state.hadMeaningfulActivity).toBe(true);

      const r2 = processHandoverChunk(
        r1.state,
        '❯ Try "edit <filepath> to..."',
        AFTER_WINDOW + 1000,
      );
      expect(r2.advanceToReview).toBe(true);
    });
  });

  // ── status tracking ────────────────────────────────────────────────────────

  describe("statusEmit and lastMeaningfulStatus", () => {
    it("emits the parsed status when non-null", () => {
      const { statusEmit, state } = processHandoverChunk(
        freshState(),
        "Here is the full solution to your problem",
        AFTER_WINDOW,
      );
      expect(statusEmit).toBe("typing");
      expect(state.lastMeaningfulStatus).toBe("typing");
    });

    it("emits null and preserves lastMeaningfulStatus for ambiguous chunks", () => {
      const s = freshState({ lastMeaningfulStatus: "typing" });
      const { statusEmit, state } = processHandoverChunk(
        s,
        "\x1b[H", // cursor-move only — parseClaudeStatus returns null
        AFTER_WINDOW,
      );
      expect(statusEmit).toBeNull();
      expect(state.lastMeaningfulStatus).toBe("typing");
    });
  });
});

// ─── processHandoverIdle ─────────────────────────────────────────────────────

describe("processHandoverIdle", () => {
  function idleState(overrides: Partial<HandoverState> = {}): HandoverState {
    return {
      phase: "spec_sent",
      hadMeaningfulActivity: false,
      lastMeaningfulStatus: null,
      specSentAt: 0,
      ...overrides,
    };
  }

  it("advances when meaningful activity seen and last status was typing", () => {
    const result = processHandoverIdle(
      idleState({ hadMeaningfulActivity: true, lastMeaningfulStatus: "typing" }),
    );
    expect(result.advanceToReview).toBe(true);
    expect(result.state.phase).toBe("done");
  });

  it("does NOT advance for a tool-use gap (lastMeaningfulStatus=thinking)", () => {
    const result = processHandoverIdle(
      idleState({
        hadMeaningfulActivity: true,
        lastMeaningfulStatus: "thinking",
      }),
    );
    expect(result.advanceToReview).toBe(false);
    expect(result.state.phase).toBe("spec_sent");
  });

  it("does NOT advance when hadMeaningfulActivity is false", () => {
    const result = processHandoverIdle(
      idleState({ hadMeaningfulActivity: false, lastMeaningfulStatus: "typing" }),
    );
    expect(result.advanceToReview).toBe(false);
  });

  it("does NOT advance when lastMeaningfulStatus is null", () => {
    const result = processHandoverIdle(
      idleState({ hadMeaningfulActivity: true, lastMeaningfulStatus: null }),
    );
    expect(result.advanceToReview).toBe(false);
  });

  it("does NOT advance when lastMeaningfulStatus is waiting", () => {
    // waiting → silence means Claude already showed the prompt; nothing to do
    const result = processHandoverIdle(
      idleState({ hadMeaningfulActivity: true, lastMeaningfulStatus: "waiting" }),
    );
    expect(result.advanceToReview).toBe(false);
  });

  it("does nothing when phase is already done", () => {
    const done = idleState({
      phase: "done",
      hadMeaningfulActivity: true,
      lastMeaningfulStatus: "typing",
    });
    const result = processHandoverIdle(done);
    expect(result.advanceToReview).toBe(false);
    expect(result.state).toBe(done); // same reference — no mutation
  });
});
