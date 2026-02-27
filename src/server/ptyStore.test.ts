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

// ─── sessions map is exported ─────────────────────────────────────────────────

describe("sessions map", () => {
  afterEach(() => {
    sessions.clear();
  });

  it("can store and retrieve a SessionEntry", () => {
    const entry = makeEntry({ currentStatus: "thinking" });
    sessions.set("test-id", entry);
    expect(sessions.get("test-id")).toBe(entry);
  });
});
