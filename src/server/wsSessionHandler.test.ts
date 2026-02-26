/**
 * @jest-environment node
 */

// ─── Mock dependencies before importing module under test ─────────────────────
//
// jest.mock() factories are hoisted BEFORE all variable declarations, so they
// cannot close over module-scope `const`/`let` variables.
//
// Solutions used here:
//  - node-pty: Build mock entirely inside the factory; expose the PTY object as
//    a named export `_mockPty` so tests can retrieve it via jest.requireMock().
//  - ptyStore: Build the sessions Map inside the factory; expose it as
//    `_sessions` so tests can pre-populate it via jest.requireMock().
//  - node:url: Use a shared *object* (not a primitive) so the factory captures
//    a stable reference.  Tests mutate `parsedQueryBag.value` to control what
//    sessionId is returned.

// Shared bag — the factory below captures the *reference* at hoist time, so
// mutations made by tests are visible inside the mock.
const parsedQueryBag: { value: Record<string, string | undefined> } = {
  value: {},
};

jest.mock("node-pty", () => {
  const mockPty = {
    write: jest.fn(),
    resize: jest.fn(),
    kill: jest.fn(),
    onData: jest.fn(),
    onExit: jest.fn(),
    pid: 1234,
  };
  return {
    spawn: jest.fn(() => mockPty),
    _mockPty: mockPty,
  };
});

jest.mock("ws", () => ({
  WebSocket: { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 },
}));

jest.mock("./ptyStore", () => {
  const map = new Map<string, object>();
  return {
    sessions: map,
    _sessions: map,
    emitStatus: jest.fn(),
    advanceToReview: jest.fn(),
  };
});

jest.mock("./ptyHandlers", () => ({
  attachTerminalHandlers: jest.fn(),
}));

jest.mock("node:url", () => ({
  // NOTE: parsedQueryBag is declared above this jest.mock call in the source,
  // but jest.mock factories are hoisted to the very top.  The `const` for
  // parsedQueryBag is also effectively hoisted (as a TDZ-safe `let`) by Babel /
  // ts-jest, which means it IS accessible here at runtime. We keep the object
  // indirection just to be safe.
  parse: jest.fn(() => ({ query: parsedQueryBag.value })),
}));

// ─── Retrieve handles to mocked modules ──────────────────────────────────────

const { _sessions: sessionsMap, emitStatus, advanceToReview } = jest.requireMock(
  "./ptyStore",
) as unknown as {
  _sessions: Map<string, object>;
  emitStatus: jest.Mock;
  advanceToReview: jest.Mock;
};

const { attachTerminalHandlers } = jest.requireMock(
  "./ptyHandlers",
) as unknown as {
  attachTerminalHandlers: jest.Mock;
};

const { spawn: mockSpawn, _mockPty: mockPtyProcess } = jest.requireMock(
  "node-pty",
) as unknown as {
  spawn: jest.Mock;
  _mockPty: {
    write: jest.Mock;
    resize: jest.Mock;
    kill: jest.Mock;
    onData: jest.Mock;
    onExit: jest.Mock;
  };
};

// ─── Import module under test ─────────────────────────────────────────────────

import { handleWsConnection } from "./wsSessionHandler";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Listener = (...args: unknown[]) => void;

/** Minimal WebSocket-like stub: supports on/emit/send/close. */
class MockWs {
  readyState = 1; // OPEN
  send = jest.fn();
  close = jest.fn();
  private _listeners: Map<string, Listener[]> = new Map();

  on(event: string, listener: Listener): this {
    const list = this._listeners.get(event) ?? [];
    list.push(listener);
    this._listeners.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const list = this._listeners.get(event) ?? [];
    for (const fn of list) {
      fn(...args);
    }
    return list.length > 0;
  }
}

function makeReq() {
  return { url: "/session" } as never;
}

function makeSave() {
  return jest.fn().mockResolvedValue(undefined);
}

function setSessionId(id: string | undefined): void {
  parsedQueryBag.value = id !== undefined ? { sessionId: id } : {};
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  sessionsMap.clear();
  parsedQueryBag.value = {};
  // Re-wire spawn to return the shared mockPtyProcess after clearAllMocks.
  mockSpawn.mockReturnValue(mockPtyProcess);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleWsConnection", () => {
  // ── missing sessionId ──────────────────────────────────────────────────────

  describe("missing sessionId", () => {
    it("sends error and closes the WS when sessionId is absent", () => {
      setSessionId(undefined);
      const ws = new MockWs();

      handleWsConnection(
        ws as never,
        makeReq(),
        new Map(),
        makeSave(),
        "claude",
      );

      expect(ws.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(ws.send.mock.calls[0][0] as string) as {
        type: string;
        message: string;
      };
      expect(msg.type).toBe("error");
      expect(msg.message).toMatch(/sessionId/i);
      expect(ws.close).toHaveBeenCalledTimes(1);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  // ── reconnect to existing live session ─────────────────────────────────────

  describe("reconnect to existing live session", () => {
    const SESSION_ID = "live-session-1";

    it("sets activeWs, replays buffer, and emits current status", () => {
      setSessionId(SESSION_ID);

      const existingEntry = {
        pty: mockPtyProcess,
        outputBuffer: [Buffer.from("hello "), Buffer.from("world")],
        bufferSize: 11,
        activeWs: null as MockWs | null,
        currentStatus: "thinking",
        idleTimer: null,
        handoverPhase: null,
        handoverSpec: "",
        specSentAt: 0,
        hadMeaningfulActivity: false,
        lastMeaningfulStatus: null,
      };
      sessionsMap.set(SESSION_ID, existingEntry);

      const ws = new MockWs();
      handleWsConnection(
        ws as never,
        makeReq(),
        new Map(),
        makeSave(),
        "claude",
      );

      expect(existingEntry.activeWs).toBe(ws);

      expect(ws.send).toHaveBeenCalledTimes(1);
      const sentMsg = JSON.parse(ws.send.mock.calls[0][0] as string) as {
        type: string;
        data: string;
      };
      expect(sentMsg.type).toBe("replay");
      const decoded = Buffer.from(sentMsg.data, "base64").toString();
      expect(decoded).toBe("hello world");

      expect(emitStatus).toHaveBeenCalledWith(ws, "thinking");
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("does not send a replay message when outputBuffer is empty", () => {
      setSessionId(SESSION_ID);

      const existingEntry = {
        pty: mockPtyProcess,
        outputBuffer: [],
        bufferSize: 0,
        activeWs: null,
        currentStatus: "waiting",
        idleTimer: null,
        handoverPhase: null,
        handoverSpec: "",
        specSentAt: 0,
        hadMeaningfulActivity: false,
        lastMeaningfulStatus: null,
      };
      sessionsMap.set(SESSION_ID, existingEntry);

      const ws = new MockWs();
      handleWsConnection(
        ws as never,
        makeReq(),
        new Map(),
        makeSave(),
        "claude",
      );

      // No replay message: ws.send must not have been called.
      expect(ws.send).not.toHaveBeenCalled();
      // emitStatus still fires.
      expect(emitStatus).toHaveBeenCalledWith(ws, "waiting");
    });
  });

  // ── new session (not in registry) ──────────────────────────────────────────

  describe("new session (not in registry)", () => {
    const SESSION_ID = "new-session-1";

    it("spawns a fresh PTY, registers the session, and wires handlers", () => {
      setSessionId(SESSION_ID);
      const registry = new Map<
        string,
        { id: string; cwd: string; createdAt: string }
      >();
      const save = makeSave();
      const ws = new MockWs();

      handleWsConnection(
        ws as never,
        makeReq(),
        registry as never,
        save,
        "claude",
      );

      // PTY spawned without --continue.
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [cmd, args] = mockSpawn.mock.calls[0] as [string, string[]];
      expect(cmd).toBe("claude");
      expect(args).toContain("--dangerously-skip-permissions");
      expect(args).not.toContain("--continue");

      // Session registered.
      expect(registry.has(SESSION_ID)).toBe(true);
      expect(registry.get(SESSION_ID)!.id).toBe(SESSION_ID);

      // saveSessionRegistry called once.
      expect(save).toHaveBeenCalledTimes(1);

      // Session in sessions map.
      expect(sessionsMap.has(SESSION_ID)).toBe(true);

      // Terminal handlers attached.
      expect(attachTerminalHandlers).toHaveBeenCalledWith(
        mockPtyProcess,
        SESSION_ID,
      );

      // emitStatus with "connecting".
      expect(emitStatus).toHaveBeenCalledWith(ws, "connecting");

      // No "resumed" message to client.
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  // ── resumed session (in registry, not in sessions map) ─────────────────────

  describe("resumed session (in registry, not in sessions map)", () => {
    const SESSION_ID = "resumed-session-1";

    it("spawns PTY with --continue, uses registry cwd, sends 'resumed'", () => {
      setSessionId(SESSION_ID);
      const registry = new Map<
        string,
        { id: string; cwd: string; createdAt: string }
      >();
      registry.set(SESSION_ID, {
        id: SESSION_ID,
        cwd: "/home/user/project",
        createdAt: new Date().toISOString(),
      });
      const save = makeSave();
      const ws = new MockWs();

      handleWsConnection(
        ws as never,
        makeReq(),
        registry as never,
        save,
        "claude",
      );

      // PTY spawned with --continue.
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = mockSpawn.mock.calls[0] as [
        string,
        string[],
        { cwd: string },
      ];
      expect(cmd).toBe("claude");
      expect(args).toContain("--continue");
      expect(opts.cwd).toBe("/home/user/project");

      // "resumed" message sent.
      expect(ws.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(ws.send.mock.calls[0][0] as string) as {
        type: string;
      };
      expect(msg.type).toBe("resumed");

      // saveSessionRegistry NOT called (entry already exists).
      expect(save).not.toHaveBeenCalled();

      // emitStatus with "connecting".
      expect(emitStatus).toHaveBeenCalledWith(ws, "connecting");

      // Recent session (just now): advanceToReview NOT called.
      expect(advanceToReview).not.toHaveBeenCalled();
    });

    it("calls advanceToReview immediately when resumed session is older than 5 minutes (pty-manager restart recovery)", () => {
      setSessionId(SESSION_ID);
      const registry = new Map<
        string,
        { id: string; cwd: string; createdAt: string }
      >();
      // Registry entry created 6 minutes ago — older than the 5-minute threshold.
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      registry.set(SESSION_ID, {
        id: SESSION_ID,
        cwd: "/home/user/project",
        createdAt: sixMinutesAgo,
      });
      const save = makeSave();
      const ws = new MockWs();

      handleWsConnection(
        ws as never,
        makeReq(),
        registry as never,
        save,
        "claude",
      );

      // Recovery: advanceToReview should be called for the old in-progress session.
      expect(advanceToReview).toHaveBeenCalledWith(SESSION_ID);
    });

    it("does NOT call advanceToReview when resumed session is less than 5 minutes old", () => {
      setSessionId(SESSION_ID);
      const registry = new Map<
        string,
        { id: string; cwd: string; createdAt: string }
      >();
      // Registry entry created 2 minutes ago — within threshold.
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      registry.set(SESSION_ID, {
        id: SESSION_ID,
        cwd: "/home/user/project",
        createdAt: twoMinutesAgo,
      });
      const ws = new MockWs();

      handleWsConnection(
        ws as never,
        makeReq(),
        registry as never,
        makeSave(),
        "claude",
      );

      expect(advanceToReview).not.toHaveBeenCalled();
    });
  });

  // ── PTY spawn failure ──────────────────────────────────────────────────────

  describe("PTY spawn failure", () => {
    const SESSION_ID = "bad-session-1";

    it("sends error and closes WS when PTY spawn throws", () => {
      setSessionId(SESSION_ID);
      mockSpawn.mockImplementationOnce(() => {
        throw new Error("spawn ENOENT");
      });
      const ws = new MockWs();

      handleWsConnection(
        ws as never,
        makeReq(),
        new Map(),
        makeSave(),
        "bad-cmd",
      );

      expect(ws.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(ws.send.mock.calls[0][0] as string) as {
        type: string;
        message: string;
      };
      expect(msg.type).toBe("error");
      expect(msg.message).toContain("ENOENT");
      expect(ws.close).toHaveBeenCalledTimes(1);
    });
  });

  // ── ws.on('message') — input forwarding ───────────────────────────────────

  describe("ws.on('message') — input forwarding", () => {
    const SESSION_ID = "msg-session-1";

    function setupConnected(): MockWs {
      setSessionId(SESSION_ID);
      const ws = new MockWs();
      handleWsConnection(
        ws as never,
        makeReq(),
        new Map(),
        makeSave(),
        "claude",
      );
      // Reset call counts so tests only observe messages sent during forwarding.
      jest.clearAllMocks();
      // clearAllMocks resets mockSpawn too, but we don't need spawn here.
      return ws;
    }

    it("forwards a binary message to pty.write as a string", () => {
      const ws = setupConnected();
      const binaryData = Buffer.from([0x01, 0x02, 0x03]);

      ws.emit("message", binaryData, true);

      expect(mockPtyProcess.write).toHaveBeenCalledTimes(1);
      expect(mockPtyProcess.write).toHaveBeenCalledWith(binaryData.toString());
    });

    it("forwards a plain text message to pty.write", () => {
      const ws = setupConnected();

      ws.emit("message", Buffer.from("ls -la\r"), false);

      expect(mockPtyProcess.write).toHaveBeenCalledTimes(1);
      expect(mockPtyProcess.write).toHaveBeenCalledWith("ls -la\r");
    });

    it("calls pty.resize for a resize JSON message and does not write to PTY", () => {
      const ws = setupConnected();
      const resizeMsg = JSON.stringify({ type: "resize", cols: 120, rows: 40 });

      ws.emit("message", Buffer.from(resizeMsg), false);

      expect(mockPtyProcess.resize).toHaveBeenCalledTimes(1);
      expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40);
      expect(mockPtyProcess.write).not.toHaveBeenCalled();
    });

    it("forwards malformed JSON as raw text to pty.write", () => {
      const ws = setupConnected();

      ws.emit("message", Buffer.from("not json {"), false);

      expect(mockPtyProcess.write).toHaveBeenCalledWith("not json {");
      expect(mockPtyProcess.resize).not.toHaveBeenCalled();
    });

    it("does nothing when session is no longer in the sessions map", () => {
      const ws = setupConnected();
      sessionsMap.delete(SESSION_ID);

      ws.emit("message", Buffer.from("orphaned"), false);

      expect(mockPtyProcess.write).not.toHaveBeenCalled();
    });
  });

  // ── ws.on('close') — detach WS without killing PTY ─────────────────────────

  describe("ws.on('close') — detach WS without killing PTY", () => {
    const SESSION_ID = "close-session-1";

    it("sets activeWs to null but keeps the session and PTY alive", () => {
      setSessionId(SESSION_ID);
      const ws = new MockWs();
      handleWsConnection(
        ws as never,
        makeReq(),
        new Map(),
        makeSave(),
        "claude",
      );

      expect(sessionsMap.has(SESSION_ID)).toBe(true);

      ws.emit("close");

      const entry = sessionsMap.get(SESSION_ID) as { activeWs: unknown };
      expect(entry.activeWs).toBeNull();

      // Session still alive.
      expect(sessionsMap.has(SESSION_ID)).toBe(true);
      // PTY not killed.
      expect(mockPtyProcess.kill).not.toHaveBeenCalled();
    });

    it("does nothing on close when the session has been removed from map", () => {
      setSessionId(SESSION_ID);
      const ws = new MockWs();
      handleWsConnection(
        ws as never,
        makeReq(),
        new Map(),
        makeSave(),
        "claude",
      );

      sessionsMap.delete(SESSION_ID);

      expect(() => ws.emit("close")).not.toThrow();
      expect(mockPtyProcess.kill).not.toHaveBeenCalled();
    });
  });
});
