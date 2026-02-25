# Claude Status Pattern Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the fragile 500ms debounce-based status detection with synchronous PTY output pattern matching so the UI accurately reflects whether Claude is thinking, typing, or waiting for input.

**Architecture:** A pure `parseClaudeStatus(chunk)` function analyses each raw PTY string and returns a typed status or `null` if the chunk is ambiguous. The server calls this in the `onData` handler and emits immediately on change — no timers. The `ClaudeStatus` type gains `thinking` and `typing` in place of `busy`, and `waiting` in place of `idle`.

**Tech Stack:** Node.js / node-pty (server), TypeScript (strict), Jest + Testing Library (tests), CSS Modules (StatusIndicator).

---

## New Status Model

| Old            | New            | Meaning                                              |
| -------------- | -------------- | ---------------------------------------------------- |
| `busy`         | `thinking`     | Spinner visible — Claude is processing               |
| `busy`         | `typing`       | Printable text streaming — Claude writing a response |
| `idle`         | `waiting`      | Input prompt shown — ready for user input            |
| `connecting`   | `connecting`   | WS not yet open _(unchanged)_                        |
| `exited`       | `exited`       | PTY process exited _(unchanged)_                     |
| `disconnected` | `disconnected` | WS closed by server _(unchanged)_                    |

## Detection Signals (by priority)

1. **`waiting`** — chunk contains `\x1b[?2004h` (bracketed-paste mode ON). Readline/Ink sends this when it renders an input prompt. Hard, synchronous signal.
2. **`thinking`** — chunk matches `/\r[⣾⣽⣻⢿⡿⣟⣯⣷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/` — carriage-return + spinner char = in-place animation.
3. **`typing`** — after stripping all ANSI escape sequences, ≥8 non-whitespace characters remain. Claude is streaming real text.
4. **`null`** — short / pure-ANSI / whitespace-only chunk. Keep current status unchanged.

---

## Task 1: Create `parseClaudeStatus` utility (pure function, TDD first)

**Files:**

- Create: `src/utils/parseClaudeStatus.ts`
- Create: `src/utils/parseClaudeStatus.test.ts`

### Step 1 — Write the failing tests

```typescript
// src/utils/parseClaudeStatus.test.ts
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

    it.each([..."⣾⣽⣻⢿⡿⣟⣯⣷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"])(
      "returns 'thinking' for spinner char %s",
      (char) => {
        expect(parseClaudeStatus(`\r${char} ok`)).toBe("thinking");
      },
    );

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
```

### Step 2 — Run tests to confirm they fail

```bash
yarn test src/utils/parseClaudeStatus.test.ts --no-coverage
```

Expected: `Cannot find module './parseClaudeStatus'`

### Step 3 — Implement the utility

```typescript
// src/utils/parseClaudeStatus.ts

/** Subset of ClaudeStatus values that onData can infer from a single chunk. */
export type ParsedStatus = "thinking" | "typing" | "waiting";

/**
 * Bracketed paste mode ON (\x1b[?2004h).
 * Readline / Ink sends this sequence immediately before rendering the input
 * prompt, making it a reliable synchronous "ready for input" signal.
 */
const BRACKETED_PASTE_ON = "\x1b[?2004h";

/**
 * Spinner animation pattern: carriage return (no newline) followed by a
 * braille or dot spinner character. This is how ora / cli-spinners redraw
 * in-place without scrolling the terminal.
 */
const SPINNER_RE = /\r[⣾⣽⣻⢿⡿⣟⣯⣷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

/**
 * Matches all standard ANSI / VT100 escape sequences so we can strip them
 * before counting printable characters.
 *
 * Covers:
 *  - CSI sequences   \x1b[…m  (colours, cursor movement, etc.)
 *  - OSC sequences   \x1b]…\x07 or \x1b\  (title, hyperlinks)
 *  - Two-byte ESC    \x1b + one char  (Fe, Fp sequences)
 */
const ANSI_RE =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])/g;

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
  // 1. Bracketed paste ON = input prompt rendered = waiting for user
  if (chunk.includes(BRACKETED_PASTE_ON)) return "waiting";

  // 2. Spinner + carriage-return = processing animation
  if (SPINNER_RE.test(chunk)) return "thinking";

  // 3. Substantial printable text = Claude is streaming its response
  const printable = stripAnsi(chunk).replace(/\s/g, "");
  if (printable.length >= TYPING_THRESHOLD) return "typing";

  return null;
}
```

### Step 4 — Run tests to confirm they pass

```bash
yarn test src/utils/parseClaudeStatus.test.ts --no-coverage
```

Expected: all tests pass, 0 failures.

### Step 5 — Commit

```bash
git add src/utils/parseClaudeStatus.ts src/utils/parseClaudeStatus.test.ts
git commit -m "feat: add parseClaudeStatus utility with pattern-based detection"
```

---

## Task 2: Update `ClaudeStatus` type and all consumers

**Files:**

- Modify: `src/hooks/useTerminalSocket.types.ts`
- Modify: `src/components/StatusIndicator/StatusIndicator.tsx` (labels)
- Modify: `src/components/StatusIndicator/StatusIndicator.module.css` (colours)
- Modify: `src/components/StatusIndicator/StatusIndicator.test.tsx`
- Modify: `src/components/StatusIndicator/StatusIndicator.stories.tsx`
- Modify: `src/app/repos/[repoId]/session/[sessionId]/SessionPage.tsx`

### Step 1 — Update the type

In `src/hooks/useTerminalSocket.types.ts`, replace the body with:

```typescript
export type ClaudeStatus =
  | "connecting"
  | "thinking"
  | "typing"
  | "waiting"
  | "exited"
  | "disconnected";
```

### Step 2 — Run type-check to see which files need updating

```bash
yarn tsc --noEmit 2>&1 | head -60
```

Expected: errors in `StatusIndicator.tsx`, `SessionPage.tsx`, `server.ts` referencing `"busy"` or `"idle"`.

### Step 3 — Update `StatusIndicator.tsx` labels

Replace the `LABELS` map:

```typescript
const LABELS: Record<ClaudeStatus, string> = {
  connecting: "Connecting",
  thinking: "Thinking",
  typing: "Typing",
  waiting: "Waiting",
  exited: "Exited",
  disconnected: "Disconnected",
};
```

### Step 4 — Update `StatusIndicator.module.css` colours

Replace the four status-dot rules with:

```css
.connecting .dot {
  background: #8b949e;
}
.thinking .dot {
  background: #f0883e;
  animation: pulse 1.2s ease-in-out infinite;
}
.typing .dot {
  background: #58a6ff;
  animation: pulse 0.8s ease-in-out infinite;
}
.waiting .dot {
  background: #3fb950;
}
.exited .dot {
  background: #6e7681;
}
.disconnected .dot {
  background: #f85149;
}

@media (prefers-reduced-motion: reduce) {
  .thinking .dot,
  .typing .dot {
    animation: none;
  }
}
```

Remove the old `.busy` and `.idle` rules.

### Step 5 — Update `StatusIndicator.test.tsx`

Replace the `statuses` array with:

```typescript
const statuses: Array<{ status: ClaudeStatus; label: string }> = [
  { status: "connecting", label: "Connecting" },
  { status: "thinking", label: "Thinking" },
  { status: "typing", label: "Typing" },
  { status: "waiting", label: "Waiting" },
  { status: "exited", label: "Exited" },
  { status: "disconnected", label: "Disconnected" },
];
```

### Step 6 — Update `StatusIndicator.stories.tsx`

Replace the `Busy` and `Idle` story exports with:

```typescript
export const Thinking: Story = {
  args: { status: "thinking" },
};

export const Typing: Story = {
  args: { status: "typing" },
};

export const Waiting: Story = {
  args: { status: "waiting" },
};
```

Remove the `Busy` and `Idle` exports.

### Step 7 — Update `repos/SessionPage.tsx` handleStatus

The current code moves a task back to "In Progress" when Claude goes `busy`. Replace with the new status values:

```typescript
function handleStatus(newStatus: ClaudeStatus) {
  setStatus(newStatus);
  if (
    (newStatus === "thinking" || newStatus === "typing") &&
    task?.status === "Review"
  ) {
    updateTask({ id: task.id, status: "In Progress" });
  }
}
```

### Step 8 — Run type-check to confirm zero errors

```bash
yarn tsc --noEmit
```

Expected: 0 errors (server.ts errors will still exist — fixed in Task 3).

### Step 9 — Run StatusIndicator tests

```bash
yarn test src/components/StatusIndicator/StatusIndicator.test.tsx --no-coverage
```

Expected: all tests pass.

### Step 10 — Commit

```bash
git add src/hooks/useTerminalSocket.types.ts \
        src/components/StatusIndicator/StatusIndicator.tsx \
        src/components/StatusIndicator/StatusIndicator.module.css \
        src/components/StatusIndicator/StatusIndicator.test.tsx \
        src/components/StatusIndicator/StatusIndicator.stories.tsx \
        "src/app/repos/[repoId]/session/[sessionId]/SessionPage.tsx"
git commit -m "feat: update ClaudeStatus type — thinking/typing/waiting replace busy/idle"
```

---

## Task 3: Refactor `server.ts` — replace debounce with pattern detection

**Files:**

- Modify: `server.ts`

### Step 1 — Remove `STATUS_DEBOUNCE_MS` constant and `scheduleIdleStatus` function

Delete lines:

- `const STATUS_DEBOUNCE_MS = 500;` (line 32)
- The entire `scheduleIdleStatus` function (lines 614–641)

### Step 2 — Update `SessionEntry` type

In the `SessionEntry` type definition:

- Remove: `statusDebounceTimer: ReturnType<typeof setTimeout> | null;`
- Rename: `hadMeaningfulBusy: boolean` → `hadMeaningfulActivity: boolean`

Update the `HandoverPhase` type — remove the now-dead `"waiting_for_idle"` value:

```typescript
type HandoverPhase = "spec_sent" | "done";
```

### Step 3 — Update all `SessionEntry` literal objects

There are two places that create `SessionEntry` objects — the HTTP POST handler (handover) and the WS handler (new session). Update both:

**HTTP POST (handover session):**

```typescript
const entry: SessionEntry = {
  pty: ptyProcess,
  outputBuffer: [],
  bufferSize: 0,
  activeWs: null,
  currentStatus: "connecting",
  handoverPhase: "spec_sent",
  handoverSpec: specText,
  specSentAt: Date.now(),
  hadMeaningfulActivity: false, // renamed
};
```

**WS handler (new/resumed session):**

```typescript
entry = {
  pty: ptyProcess,
  outputBuffer: [],
  bufferSize: 0,
  activeWs: ws,
  currentStatus: "connecting",
  handoverPhase: null,
  handoverSpec: "",
  specSentAt: 0,
  hadMeaningfulActivity: false, // renamed
};
```

### Step 4 — Add import for `parseClaudeStatus`

At the top of `server.ts`, after the existing imports, add:

```typescript
import { parseClaudeStatus } from "./src/utils/parseClaudeStatus";
```

> Note: `server.ts` lives at the project root, so the path is `./src/utils/parseClaudeStatus`.

### Step 5 — Rewrite the `onData` handler (handover session path)

Find the `ptyProcess.onData` handler inside the HTTP POST route (around line 880). Replace the body with:

```typescript
ptyProcess.onData((data) => {
  const chunk = Buffer.from(data);
  const e = sessions.get(sessionId);
  if (!e) return;

  appendToBuffer(e, chunk);
  if (e.activeWs?.readyState === WebSocket.OPEN) {
    e.activeWs.send(chunk);
  }

  const parsed = parseClaudeStatus(data);
  if (parsed !== null && parsed !== e.currentStatus) {
    e.currentStatus = parsed;
    emitStatus(e.activeWs, parsed);
  }

  // Track meaningful activity (thinking/typing) after the echo window
  if (
    e.handoverPhase === "spec_sent" &&
    !e.hadMeaningfulActivity &&
    (parsed === "thinking" || parsed === "typing") &&
    Date.now() - e.specSentAt > SPEC_ECHO_WINDOW_MS
  ) {
    e.hadMeaningfulActivity = true;
  }

  // Advance to Review when Claude shows the prompt after meaningful work
  if (
    e.handoverPhase === "spec_sent" &&
    parsed === "waiting" &&
    e.hadMeaningfulActivity
  ) {
    e.handoverPhase = "done";
    advanceToReview(sessionId);
  }
});
```

### Step 6 — Rewrite the `onData` handler (WS/plain session path)

Find the second `ptyProcess.onData` handler inside the WS connection handler (around line 1480). Replace the body with:

```typescript
ptyProcess.onData((data) => {
  const chunk = Buffer.from(data);
  const e = sessions.get(sessionId)!;
  appendToBuffer(e, chunk);
  if (e.activeWs?.readyState === WebSocket.OPEN) {
    e.activeWs.send(chunk);
  }

  const parsed = parseClaudeStatus(data);
  if (parsed !== null && parsed !== e.currentStatus) {
    e.currentStatus = parsed;
    emitStatus(e.activeWs, parsed);
  }
});
```

### Step 7 — Remove the stale `hadMeaningfulBusy` references in `onExit`

The `onExit` handler in the handover path (around line 906) references `e.hadMeaningfulBusy`. Rename those references to `e.hadMeaningfulActivity`.

Also remove the leftover `scheduleIdleStatus` call from `onExit` if any remains.

### Step 8 — Run type-check

```bash
yarn tsc --noEmit
```

Expected: 0 errors.

### Step 9 — Run full test suite

```bash
yarn test --no-coverage
```

Expected: all tests pass. The `useTerminalSocket.test.ts` tests use `"busy"` in status frames — those will still pass because the hook just forwards whatever `value` the server sends. Update those test assertions to use `"thinking"` for correctness:

In `src/hooks/useTerminalSocket.test.ts`, find the test `"calls onStatus with the value from a status frame"` and update the status value to `"thinking"`:

```typescript
it("calls onStatus with the value from a status frame", () => {
  const onStatus = jest.fn();
  renderHook(() =>
    useTerminalSocket(mockXterm as never, "session-abc", onStatus),
  );

  MockWebSocket.lastInstance.onmessage?.({
    data: JSON.stringify({ type: "status", value: "thinking" }),
  } as MessageEvent);

  expect(onStatus).toHaveBeenCalledWith("thinking");
});
```

### Step 10 — Commit

```bash
git add server.ts src/hooks/useTerminalSocket.test.ts
git commit -m "feat: replace debounce status detection with PTY pattern parsing"
```

---

## Task 4: Final verification

### Step 1 — Full test suite with coverage

```bash
yarn test --coverage 2>&1 | tail -30
```

Expected: 0 failures. New `parseClaudeStatus.ts` should show high coverage.

### Step 2 — Type check

```bash
yarn tsc --noEmit
```

Expected: 0 errors.

### Step 3 — Lint

```bash
yarn lint
```

Expected: 0 warnings, 0 errors.

### Step 4 — Commit if anything was touched during verification

```bash
git add -p
git commit -m "chore: fix lint/type issues after status refactor"
```

---

## Notes for the implementer

- **Pattern tuning**: The `TYPING_THRESHOLD = 8` and the `BRACKETED_PASTE_ON` signal are based on known Claude CLI / Ink behaviour. If live testing shows these need adjustment, update the constant in `parseClaudeStatus.ts` and add a regression test.
- **`waiting_for_idle`**: This `HandoverPhase` value was already dead code (no path ever set it). We're removing it as part of this change.
- **Reconnect behaviour**: On WS reconnect the server already calls `emitStatus(ws, entry.currentStatus)` — this is still correct; the client will receive the last known pattern-detected status.
- **`SPEC_ECHO_WINDOW_MS`**: This constant is still needed to ignore startup echo noise during handover. It is NOT a debounce — it's a fixed window after spec injection.
