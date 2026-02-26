/**
 * @jest-environment node
 */
import { WebSocket } from "ws";

import {
  advanceToReview,
  appendToBuffer,
  backToInProgress,
  BUFFER_CAP,
  emitStatus,
  scheduleIdleStatus,
  SESSION_IDLE_MS,
  sessions,
  type ClaudeStatus,
  type SessionEntry,
} from "./ptyStore";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal SessionEntry with safe defaults (no real PTY). */
function makeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    pty: null as unknown as SessionEntry["pty"],
    outputBuffer: [],
    bufferSize: 0,
    activeWs: null,
    currentStatus: "connecting",
    idleTimer: null,
    handoverPhase: null,
    handoverSpec: "",
    specSentAt: 0,
    hadMeaningfulActivity: false,
    lastMeaningfulStatus: null,
    supportsBracketedPaste: false,
    ...overrides,
  };
}

/** Create a mock WebSocket whose readyState and send() we control. */
function makeMockWs(
  readyState: number = WebSocket.OPEN,
): jest.Mocked<Pick<WebSocket, "readyState" | "send">> {
  return {
    readyState,
    send: jest.fn(),
  } as jest.Mocked<Pick<WebSocket, "readyState" | "send">>;
}

// ─── appendToBuffer ───────────────────────────────────────────────────────────

describe("appendToBuffer", () => {
  it("appends a chunk to the buffer and increments bufferSize", () => {
    const entry = makeEntry();
    const chunk = Buffer.from("hello");

    appendToBuffer(entry, chunk);

    expect(entry.outputBuffer).toHaveLength(1);
    expect(entry.outputBuffer[0]).toBe(chunk);
    expect(entry.bufferSize).toBe(5);
  });

  it("trims the oldest chunk when bufferSize exceeds BUFFER_CAP", () => {
    const entry = makeEntry();

    // Fill buffer to just under cap with a large initial chunk
    const bigChunk = Buffer.alloc(BUFFER_CAP - 10);
    appendToBuffer(entry, bigChunk);
    expect(entry.bufferSize).toBe(BUFFER_CAP - 10);

    // Adding a chunk that tips us over the cap should evict the first chunk
    const tippingChunk = Buffer.alloc(20);
    appendToBuffer(entry, tippingChunk);

    // The oldest (bigChunk) must have been removed
    expect(entry.outputBuffer).toHaveLength(1);
    expect(entry.outputBuffer[0]).toBe(tippingChunk);
    expect(entry.bufferSize).toBe(20);
  });

  it("never removes the last remaining chunk even when over cap", () => {
    const entry = makeEntry();

    // A single chunk larger than the cap: cannot be trimmed because we require
    // at least 1 chunk to remain.
    const oversizedChunk = Buffer.alloc(BUFFER_CAP + 100);
    appendToBuffer(entry, oversizedChunk);

    expect(entry.outputBuffer).toHaveLength(1);
    expect(entry.bufferSize).toBe(BUFFER_CAP + 100);
  });
});

// ─── emitStatus ──────────────────────────────────────────────────────────────

describe("emitStatus", () => {
  it("sends a JSON status message when the WebSocket is open", () => {
    const ws = makeMockWs(WebSocket.OPEN);

    emitStatus(ws as unknown as WebSocket, "thinking");

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "status", value: "thinking" }),
    );
  });

  it("does nothing when ws is null", () => {
    // Should not throw
    expect(() => emitStatus(null, "waiting")).not.toThrow();
  });

  it("does nothing when the WebSocket is not open (CONNECTING state)", () => {
    const ws = makeMockWs(WebSocket.CONNECTING);

    emitStatus(ws as unknown as WebSocket, "typing");

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("does nothing when the WebSocket is closed", () => {
    const ws = makeMockWs(WebSocket.CLOSED);

    emitStatus(ws as unknown as WebSocket, "waiting");

    expect(ws.send).not.toHaveBeenCalled();
  });
});

// ─── scheduleIdleStatus ───────────────────────────────────────────────────────

describe("scheduleIdleStatus", () => {
  const SESSION_ID = "test-session-idle";

  beforeEach(() => {
    jest.useFakeTimers();
    sessions.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    sessions.clear();
  });

  it("sets idleTimer on the entry", () => {
    const entry = makeEntry();
    sessions.set(SESSION_ID, entry);

    scheduleIdleStatus(entry, SESSION_ID);

    expect(entry.idleTimer).not.toBeNull();
  });

  it("clears an existing timer and resets it when called again", () => {
    const entry = makeEntry();
    sessions.set(SESSION_ID, entry);

    scheduleIdleStatus(entry, SESSION_ID);
    const firstTimer = entry.idleTimer;

    scheduleIdleStatus(entry, SESSION_ID);
    const secondTimer = entry.idleTimer;

    expect(secondTimer).not.toBeNull();
    // The timers should be distinct objects (new timer was created)
    expect(secondTimer).not.toBe(firstTimer);
  });

  it("sets currentStatus to waiting and emits waiting after SESSION_IDLE_MS silence", () => {
    const ws = makeMockWs(WebSocket.OPEN);
    const entry = makeEntry({
      currentStatus: "thinking",
      activeWs: ws as unknown as WebSocket,
    });
    sessions.set(SESSION_ID, entry);

    scheduleIdleStatus(entry, SESSION_ID);
    jest.advanceTimersByTime(SESSION_IDLE_MS);

    expect(entry.currentStatus).toBe("waiting");
    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "status", value: "waiting" }),
    );
  });

  it("does not emit waiting again when currentStatus is already waiting", () => {
    const ws = makeMockWs(WebSocket.OPEN);
    const entry = makeEntry({
      currentStatus: "waiting",
      activeWs: ws as unknown as WebSocket,
    });
    sessions.set(SESSION_ID, entry);

    scheduleIdleStatus(entry, SESSION_ID);
    jest.advanceTimersByTime(SESSION_IDLE_MS);

    expect(ws.send).not.toHaveBeenCalled();
  });

  it("does not fire if the session has been removed from the map before the timer fires", () => {
    const ws = makeMockWs(WebSocket.OPEN);
    const entry = makeEntry({
      currentStatus: "thinking",
      activeWs: ws as unknown as WebSocket,
    });
    sessions.set(SESSION_ID, entry);

    scheduleIdleStatus(entry, SESSION_ID);
    sessions.delete(SESSION_ID); // remove before timer fires
    jest.advanceTimersByTime(SESSION_IDLE_MS);

    // Should not have changed anything
    expect(ws.send).not.toHaveBeenCalled();
  });

  describe("advanceToReview is called after SESSION_IDLE_MS with spec_sent + meaningful activity + typing", () => {
    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("calls advanceToReview when conditions are met", () => {
      const entry = makeEntry({
        currentStatus: "typing",
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: true,
        lastMeaningfulStatus: "typing",
      });
      sessions.set(SESSION_ID, entry);

      scheduleIdleStatus(entry, SESSION_ID);
      jest.advanceTimersByTime(SESSION_IDLE_MS);

      expect(entry.handoverPhase).toBe("done");
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(fetchUrl).toContain(`/sessions/${SESSION_ID}/advance-to-review`);
    });

    it("does NOT call advanceToReview when lastMeaningfulStatus is thinking (tool-use gap)", () => {
      const entry = makeEntry({
        currentStatus: "thinking",
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: true,
        lastMeaningfulStatus: "thinking",
      });
      sessions.set(SESSION_ID, entry);

      scheduleIdleStatus(entry, SESSION_ID);
      jest.advanceTimersByTime(SESSION_IDLE_MS);

      expect(entry.handoverPhase).toBe("spec_sent");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("does NOT call advanceToReview when hadMeaningfulActivity is false and lastMeaningfulStatus is typing", () => {
      const entry = makeEntry({
        currentStatus: "typing",
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: false,
        lastMeaningfulStatus: "typing",
      });
      sessions.set(SESSION_ID, entry);

      scheduleIdleStatus(entry, SESSION_ID);
      jest.advanceTimersByTime(SESSION_IDLE_MS);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("calls advanceToReview when lastMeaningfulStatus is waiting (spinner fired within echo window)", () => {
      // Covers the case where Claude processed the spec but the thinking
      // spinner appeared within SPEC_ECHO_WINDOW_MS so hadMeaningfulActivity
      // was never set — yet Claude is clearly idle at the ❯ prompt.
      const entry = makeEntry({
        currentStatus: "waiting",
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: false,
        lastMeaningfulStatus: "waiting",
      });
      sessions.set(SESSION_ID, entry);

      scheduleIdleStatus(entry, SESSION_ID);
      jest.advanceTimersByTime(SESSION_IDLE_MS);

      expect(entry.handoverPhase).toBe("done");
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const fetchUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(fetchUrl).toContain(`/sessions/${SESSION_ID}/advance-to-review`);
    });

    it("does NOT call advanceToReview when handoverPhase is not spec_sent", () => {
      const entry = makeEntry({
        currentStatus: "typing",
        handoverPhase: null,
        hadMeaningfulActivity: true,
        lastMeaningfulStatus: "typing",
      });
      sessions.set(SESSION_ID, entry);

      scheduleIdleStatus(entry, SESSION_ID);
      jest.advanceTimersByTime(SESSION_IDLE_MS);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

// ─── advanceToReview ─────────────────────────────────────────────────────────

describe("advanceToReview", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls fetch with the correct advance-to-review URL", () => {
    advanceToReview("session-abc");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain(
      "/api/internal/sessions/session-abc/advance-to-review",
    );
    expect(options).toEqual({ method: "POST" });
  });

  it("uses SERVER_PORT env var when set", () => {
    const original = process.env.SERVER_PORT;
    process.env.SERVER_PORT = "4444";

    advanceToReview("session-xyz");

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain("localhost:4444");

    process.env.SERVER_PORT = original;
  });

  it("falls back to port 3000 when SERVER_PORT is not set", () => {
    const original = process.env.SERVER_PORT;
    delete process.env.SERVER_PORT;

    advanceToReview("session-fallback");

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain("localhost:3000");
    expect(url).toContain("/sessions/session-fallback/advance-to-review");

    process.env.SERVER_PORT = original;
  });

  it("silently swallows fetch errors", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("connection refused"),
    );

    // Should not throw -- the void + .catch(() => {}) swallows the error
    expect(() => advanceToReview("session-err")).not.toThrow();

    // Flush the microtask queue so the rejected promise settles
    await Promise.resolve();
  });
});

// ─── backToInProgress ─────────────────────────────────────────────────────────

describe("backToInProgress", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls fetch with the correct back-to-in-progress URL", () => {
    backToInProgress("session-abc");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain(
      "/api/internal/sessions/session-abc/back-to-in-progress",
    );
    expect(options).toEqual({ method: "POST" });
  });

  it("uses SERVER_PORT env var when set", () => {
    const original = process.env.SERVER_PORT;
    process.env.SERVER_PORT = "4444";

    backToInProgress("session-xyz");

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain("localhost:4444");

    process.env.SERVER_PORT = original;
  });

  it("falls back to port 3000 when SERVER_PORT is not set", () => {
    const original = process.env.SERVER_PORT;
    delete process.env.SERVER_PORT;

    backToInProgress("session-fallback");

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain("localhost:3000");
    expect(url).toContain("/sessions/session-fallback/back-to-in-progress");

    process.env.SERVER_PORT = original;
  });

  it("silently swallows fetch errors", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("connection refused"),
    );

    expect(() => backToInProgress("session-err")).not.toThrow();

    await Promise.resolve();
  });
});

// ─── Type export smoke test ───────────────────────────────────────────────────

describe("exported types", () => {
  it("ClaudeStatus values are assignable", () => {
    const statuses: ClaudeStatus[] = [
      "connecting",
      "thinking",
      "typing",
      "waiting",
      "exited",
      "disconnected",
    ];
    expect(statuses).toHaveLength(6);
  });
});
