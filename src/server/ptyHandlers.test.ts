/**
 * @jest-environment node
 */
import type { IPty } from "node-pty";
import { WebSocket } from "ws";

import { attachHandoverHandlers, attachTerminalHandlers } from "./ptyHandlers";
import {
  advanceToReview,
  appendToBuffer,
  emitStatus,
  scheduleIdleStatus,
  sessions,
  SPEC_ECHO_WINDOW_MS,
} from "./ptyStore";
import type { SessionEntry } from "./ptyStore";
import { parseClaudeStatus } from "../utils/parseClaudeStatus";

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock("./ptyStore", () => ({
  sessions: new Map(),
  appendToBuffer: jest.fn(),
  emitStatus: jest.fn(),
  scheduleIdleStatus: jest.fn(),
  advanceToReview: jest.fn(),
  SPEC_ECHO_WINDOW_MS: 500,
}));

jest.mock("../utils/parseClaudeStatus");

// ─── Typed mock helpers ───────────────────────────────────────────────────────

const mockedAppendToBuffer = appendToBuffer as jest.MockedFunction<
  typeof appendToBuffer
>;
const mockedEmitStatus = emitStatus as jest.MockedFunction<typeof emitStatus>;
const mockedScheduleIdleStatus = scheduleIdleStatus as jest.MockedFunction<
  typeof scheduleIdleStatus
>;
const mockedAdvanceToReview = advanceToReview as jest.MockedFunction<
  typeof advanceToReview
>;
const mockedParseClaudeStatus = parseClaudeStatus as jest.MockedFunction<
  typeof parseClaudeStatus
>;

// ─── Fake PTY factory ─────────────────────────────────────────────────────────

function makeFakePty() {
  let onDataCb: ((data: string) => void) | null = null;
  let onExitCb: ((result: { exitCode: number }) => void) | null = null;
  return {
    pty: {
      onData: jest.fn((cb: (data: string) => void) => {
        onDataCb = cb;
      }),
      onExit: jest.fn((cb: (result: { exitCode: number }) => void) => {
        onExitCb = cb;
      }),
      write: jest.fn(),
      kill: jest.fn(),
    },
    triggerData: (data: string) => onDataCb!(data),
    triggerExit: (code: number) => onExitCb!({ exitCode: code }),
  };
}

// ─── Fake WebSocket factory ───────────────────────────────────────────────────

function makeMockWs(
  readyState: number = WebSocket.OPEN,
): jest.Mocked<Pick<WebSocket, "readyState" | "send" | "close">> {
  return {
    readyState,
    send: jest.fn(),
    close: jest.fn(),
  } as jest.Mocked<Pick<WebSocket, "readyState" | "send" | "close">>;
}

// ─── Entry builder ────────────────────────────────────────────────────────────

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
    ...overrides,
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  sessions.clear();
  jest.clearAllMocks();
  // Default: parseClaudeStatus returns null (no status parsed)
  mockedParseClaudeStatus.mockReturnValue(null);
});

afterEach(() => {
  jest.useRealTimers();
  sessions.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// attachHandoverHandlers
// ─────────────────────────────────────────────────────────────────────────────

describe("attachHandoverHandlers", () => {
  const SESSION_ID = "handover-session-1";

  // ── onData: handover phase transitions ────────────────────────────────────

  describe("onData — handover phase transitions", () => {
    it("waiting_for_prompt + parsed=waiting: writes spec via bracketed paste and sets phase to spec_sent", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: "waiting_for_prompt",
        handoverSpec: "Do something useful",
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("waiting");

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("❯ ");

      expect(fake.pty.write).toHaveBeenCalledTimes(1);
      expect(fake.pty.write).toHaveBeenCalledWith(
        `\x1b[200~Do something useful\x1b[201~\r`,
      );
      expect(entry.handoverPhase).toBe("spec_sent");
      expect(entry.hadMeaningfulActivity).toBe(false);
    });

    it("spec_sent phase + data includes ⎿: sets hadMeaningfulActivity = true (no time gate)", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        specSentAt: Date.now(),
        hadMeaningfulActivity: false,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue(null);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      // Trigger within the echo window — ⎿ should still set activity
      fake.triggerData("  ⎿  tool result here");

      expect(entry.hadMeaningfulActivity).toBe(true);
    });

    it("spec_sent phase + parsed=thinking after SPEC_ECHO_WINDOW_MS: sets hadMeaningfulActivity = true", () => {
      const fake = makeFakePty();
      const now = 1_000_000;
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        specSentAt: now,
        hadMeaningfulActivity: false,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("thinking");

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      // Advance system time so Date.now() is past the window
      jest.setSystemTime(now + SPEC_ECHO_WINDOW_MS + 1);
      fake.triggerData("\r⣾ Thinking...");

      expect(entry.hadMeaningfulActivity).toBe(true);
    });

    it("spec_sent phase + parsed=thinking BEFORE SPEC_ECHO_WINDOW_MS: does NOT set hadMeaningfulActivity", () => {
      const fake = makeFakePty();
      const now = 1_000_000;
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        specSentAt: now,
        hadMeaningfulActivity: false,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("thinking");

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      // Advance time to within the echo window
      jest.setSystemTime(now + 100);
      fake.triggerData("\r⣾ Thinking...");

      expect(entry.hadMeaningfulActivity).toBe(false);
    });

    it("fast path: parsed=waiting + phase=spec_sent + hadMeaningfulActivity=true → sets phase=done, calls advanceToReview, clears idleTimer", () => {
      const fake = makeFakePty();
      const fakeTimer = setTimeout(() => {}, 99999);
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: true,
        idleTimer: fakeTimer,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("waiting");

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("❯ ");

      expect(entry.handoverPhase).toBe("done");
      expect(entry.idleTimer).toBeNull();
      expect(mockedAdvanceToReview).toHaveBeenCalledWith(SESSION_ID);
    });

    it("fast path does NOT fire when hadMeaningfulActivity is false", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: false,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("waiting");

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("❯ ");

      expect(entry.handoverPhase).toBe("spec_sent");
      expect(mockedAdvanceToReview).not.toHaveBeenCalled();
    });

    it("falls through to scheduleIdleStatus when no special condition matches", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: false,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("typing");

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("Some regular typing output that is long enough");

      expect(mockedScheduleIdleStatus).toHaveBeenCalledWith(entry, SESSION_ID);
    });
  });

  // ── onData: buffer and status ─────────────────────────────────────────────

  describe("onData — buffer and status", () => {
    it("calls appendToBuffer on every data event", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("chunk one");
      fake.triggerData("chunk two");

      expect(mockedAppendToBuffer).toHaveBeenCalledTimes(2);
      expect(mockedAppendToBuffer).toHaveBeenNthCalledWith(
        1,
        entry,
        Buffer.from("chunk one"),
      );
      expect(mockedAppendToBuffer).toHaveBeenNthCalledWith(
        2,
        entry,
        Buffer.from("chunk two"),
      );
    });

    it("sends chunk to activeWs when open", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("hello ws");

      expect(ws.send).toHaveBeenCalledWith(Buffer.from("hello ws"));
    });

    it("does not send to activeWs when ws is not open", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.CLOSED);
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("hello ws");

      expect(ws.send).not.toHaveBeenCalled();
    });

    it("updates currentStatus and calls emitStatus when parsed status changes", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        currentStatus: "connecting",
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("thinking");

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("\r⣾");

      expect(entry.currentStatus).toBe("thinking");
      expect(entry.lastMeaningfulStatus).toBe("thinking");
      expect(mockedEmitStatus).toHaveBeenCalledWith(ws, "thinking");
    });

    it("does not call emitStatus when parsed status is unchanged", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        currentStatus: "thinking",
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("thinking");

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("\r⣾");

      expect(mockedEmitStatus).not.toHaveBeenCalled();
    });

    it("does not call emitStatus when parseClaudeStatus returns null", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        currentStatus: "thinking",
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue(null);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("\x1b[H");

      expect(mockedEmitStatus).not.toHaveBeenCalled();
    });

    it("returns early when session is not found in the map", () => {
      const fake = makeFakePty();
      // Do NOT put the session in sessions map

      attachHandoverHandlers(
        fake.pty as unknown as IPty,
        "nonexistent-session",
      );
      fake.triggerData("some data");

      expect(mockedAppendToBuffer).not.toHaveBeenCalled();
      expect(mockedScheduleIdleStatus).not.toHaveBeenCalled();
    });
  });

  // ── onExit ────────────────────────────────────────────────────────────────

  describe("onExit", () => {
    it("clears idleTimer on exit (calls clearTimeout, does not null-assign)", () => {
      const fake = makeFakePty();
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const fakeTimer = setTimeout(() => {}, 99999);
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        idleTimer: fakeTimer,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimer);
      clearTimeoutSpy.mockRestore();
    });

    it("sets currentStatus to exited", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: true,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(entry.currentStatus).toBe("exited");
    });

    it("sends exit message and closes activeWs when open", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: true,
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(42);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "exit", code: 42 }),
      );
      expect(ws.close).toHaveBeenCalledTimes(1);
    });

    it("does not send exit message when ws is not open", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.CLOSED);
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: true,
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(1);

      expect(ws.send).not.toHaveBeenCalled();
      expect(ws.close).not.toHaveBeenCalled();
    });

    it("removes session from sessions Map", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        hadMeaningfulActivity: true,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(sessions.has(SESSION_ID)).toBe(false);
    });

    it("calls advanceToReview if isHandover=true and handover not yet done", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: "spec_sent",
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(mockedAdvanceToReview).toHaveBeenCalledWith(SESSION_ID);
    });

    it("does NOT call advanceToReview when handover was already done", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: "done",
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(mockedAdvanceToReview).not.toHaveBeenCalled();
    });

    it("does NOT call advanceToReview when session was already removed (e === undefined)", () => {
      const fake = makeFakePty();
      // Do NOT add to sessions map — simulates session pre-removed by recall

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(mockedAdvanceToReview).not.toHaveBeenCalled();
    });

    it("does NOT call advanceToReview for non-handover session (handoverPhase=null)", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: null,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachHandoverHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(mockedAdvanceToReview).not.toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// attachTerminalHandlers
// ─────────────────────────────────────────────────────────────────────────────

describe("attachTerminalHandlers", () => {
  const SESSION_ID = "terminal-session-1";

  // ── onData ────────────────────────────────────────────────────────────────

  describe("onData", () => {
    it("calls appendToBuffer on every data event", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("first chunk");
      fake.triggerData("second chunk");

      expect(mockedAppendToBuffer).toHaveBeenCalledTimes(2);
      expect(mockedAppendToBuffer).toHaveBeenNthCalledWith(
        1,
        entry,
        Buffer.from("first chunk"),
      );
      expect(mockedAppendToBuffer).toHaveBeenNthCalledWith(
        2,
        entry,
        Buffer.from("second chunk"),
      );
    });

    it("sends chunk to ws when open", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("terminal output");

      expect(ws.send).toHaveBeenCalledWith(Buffer.from("terminal output"));
    });

    it("does not send to ws when not open", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.CLOSED);
      const entry = makeEntry({
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("terminal output");

      expect(ws.send).not.toHaveBeenCalled();
    });

    it("does NOT set hadMeaningfulActivity when parsed=thinking (terminal uses ⎿ only)", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        hadMeaningfulActivity: false,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("thinking");

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("\r⣾ Thinking...");

      // Terminal handler only sets hadMeaningfulActivity via ⎿, not thinking
      expect(entry.hadMeaningfulActivity).toBe(false);
    });

    it("sets hadMeaningfulActivity when data includes ⎿", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        hadMeaningfulActivity: false,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue(null);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("  ⎿  tool result output");

      expect(entry.hadMeaningfulActivity).toBe(true);
    });

    it("calls advanceToReview when parsed=waiting and hadMeaningfulActivity=true", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        hadMeaningfulActivity: true,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("waiting");

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("❯ ");

      expect(mockedAdvanceToReview).toHaveBeenCalledWith(SESSION_ID);
    });

    it("does NOT call advanceToReview when parsed=waiting but hadMeaningfulActivity=false", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        hadMeaningfulActivity: false,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("waiting");

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("❯ ");

      expect(mockedAdvanceToReview).not.toHaveBeenCalled();
    });

    it("calls scheduleIdleStatus on every data event", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("chunk a");
      fake.triggerData("chunk b");
      fake.triggerData("chunk c");

      expect(mockedScheduleIdleStatus).toHaveBeenCalledTimes(3);
      expect(mockedScheduleIdleStatus).toHaveBeenCalledWith(entry, SESSION_ID);
    });

    it("updates currentStatus and calls emitStatus when parsed status changes", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        currentStatus: "connecting",
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("typing");

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("Some text from Claude that is long enough");

      expect(entry.currentStatus).toBe("typing");
      expect(entry.lastMeaningfulStatus).toBe("typing");
      expect(mockedEmitStatus).toHaveBeenCalledWith(ws, "typing");
    });

    it("does not call emitStatus when parsed status is unchanged", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        currentStatus: "typing",
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue("typing");

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("more typing output");

      expect(mockedEmitStatus).not.toHaveBeenCalled();
    });

    it("does not call emitStatus when parseClaudeStatus returns null", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        currentStatus: "thinking",
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);
      mockedParseClaudeStatus.mockReturnValue(null);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerData("\x1b[H");

      expect(mockedEmitStatus).not.toHaveBeenCalled();
    });

    it("⎿ sets hadMeaningfulActivity and then waiting triggers advanceToReview in subsequent call", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        hadMeaningfulActivity: false,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);

      // First chunk: ⎿ sets meaningful activity
      mockedParseClaudeStatus.mockReturnValue(null);
      fake.triggerData("  ⎿  tool completed");
      expect(entry.hadMeaningfulActivity).toBe(true);
      expect(mockedAdvanceToReview).not.toHaveBeenCalled();

      // Second chunk: waiting prompt → advance
      mockedParseClaudeStatus.mockReturnValue("waiting");
      fake.triggerData("❯ ");
      expect(mockedAdvanceToReview).toHaveBeenCalledWith(SESSION_ID);
    });
  });

  // ── onExit ────────────────────────────────────────────────────────────────

  describe("onExit", () => {
    it("clears idleTimer on exit (calls clearTimeout, does not null-assign)", () => {
      const fake = makeFakePty();
      const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
      const fakeTimer = setTimeout(() => {}, 99999);
      const entry = makeEntry({
        idleTimer: fakeTimer,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimer);
      clearTimeoutSpy.mockRestore();
    });

    it("sets currentStatus to exited", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(entry.currentStatus).toBe("exited");
    });

    it("sends exit message and closes ws when open", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.OPEN);
      const entry = makeEntry({
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(7);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "exit", code: 7 }),
      );
      expect(ws.close).toHaveBeenCalledTimes(1);
    });

    it("does not send exit message when ws is not open", () => {
      const fake = makeFakePty();
      const ws = makeMockWs(WebSocket.CONNECTING);
      const entry = makeEntry({
        activeWs: ws as unknown as WebSocket,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(1);

      expect(ws.send).not.toHaveBeenCalled();
      expect(ws.close).not.toHaveBeenCalled();
    });

    it("removes session from sessions Map", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(sessions.has(SESSION_ID)).toBe(false);
    });

    it("handles gracefully when session is not found on exit (no throw)", () => {
      const fake = makeFakePty();
      // Session not in map

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);

      expect(() => fake.triggerExit(0)).not.toThrow();
      expect(sessions.has(SESSION_ID)).toBe(false);
    });

    it("does not call advanceToReview on terminal exit (non-handover)", () => {
      const fake = makeFakePty();
      const entry = makeEntry({
        handoverPhase: null,
        pty: fake.pty as unknown as SessionEntry["pty"],
      });
      sessions.set(SESSION_ID, entry);

      attachTerminalHandlers(fake.pty as unknown as IPty, SESSION_ID);
      fake.triggerExit(0);

      expect(mockedAdvanceToReview).not.toHaveBeenCalled();
    });
  });
});
