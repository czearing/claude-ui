/**
 * @jest-environment node
 */

// ─── Mock "ws" ────────────────────────────────────────────────────────────────
//
// jest.mock factories are hoisted to the top of the file — before any variable
// declarations — so we cannot close over module-scope consts inside them.
// We avoid require() (forbidden by @typescript-eslint/no-require-imports) by
// implementing a minimal inline EventEmitter rather than calling require().
// The class is exposed as a named property `_MockWebSocket` so tests can
// retrieve it via jest.requireMock() after the mock is registered.

jest.mock("ws", () => {
  type Listener = (...args: unknown[]) => void;

  class _MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static _instances: _MockWebSocket[] = [];

    readyState: number;
    send: jest.Mock;
    close: jest.Mock;
    url: string;
    private _listeners: Map<string, Listener[]> = new Map();

    constructor(url: string) {
      this.url = url;
      this.readyState = _MockWebSocket.CONNECTING;
      this.send = jest.fn();
      this.close = jest.fn();
      _MockWebSocket._instances.push(this);
    }

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

  return {
    WebSocket: _MockWebSocket,
    WebSocketServer: jest.fn(),
    _MockWebSocket,
  };
});

// Retrieve the mock class so tests can create instances and inspect them.
const { _MockWebSocket: MockWebSocket } = jest.requireMock("ws") as unknown as {
  _MockWebSocket: {
    new (url: string): {
      readyState: number;
      send: jest.Mock;
      close: jest.Mock;
      url: string;
      on(event: string, listener: (...args: unknown[]) => void): void;
      emit(event: string, ...args: unknown[]): boolean;
    };
    _instances: Array<{
      readyState: number;
      send: jest.Mock;
      close: jest.Mock;
      url: string;
      on(event: string, listener: (...args: unknown[]) => void): void;
      emit(event: string, ...args: unknown[]): boolean;
    }>;
    CONNECTING: number;
    OPEN: number;
    CLOSING: number;
    CLOSED: number;
  };
};

import { handleTerminalUpgrade } from "./wsProxy";

// ─── Types ────────────────────────────────────────────────────────────────────

type MockWsInstance = (typeof MockWebSocket._instances)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBrowserWs(): MockWsInstance {
  const ws = new MockWebSocket("browser");
  ws.readyState = 1; // OPEN
  return ws;
}

function makeMockWss(browserWs: MockWsInstance) {
  return {
    handleUpgrade: jest.fn(
      (
        _req: unknown,
        _socket: unknown,
        _head: unknown,
        cb: (ws: MockWsInstance) => void,
      ) => {
        cb(browserWs);
      },
    ),
  };
}

function makeReq(url: string) {
  return { url } as never;
}

function makeHead() {
  return Buffer.alloc(0);
}

function getPtymgrWs(browserWs: MockWsInstance): MockWsInstance {
  return MockWebSocket._instances.find((ws) => ws !== browserWs)!;
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  MockWebSocket._instances.length = 0;
  jest.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleTerminalUpgrade", () => {
  describe("missing sessionId", () => {
    it("sends an error and closes when sessionId is absent from query", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal"),
        {} as never,
        makeHead(),
        9001,
      );

      expect(browserWs.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(browserWs.send.mock.calls[0][0] as string) as {
        type: string;
        message: string;
      };
      expect(msg.type).toBe("error");
      expect(msg.message).toMatch(/sessionId/i);
      expect(browserWs.close).toHaveBeenCalledTimes(1);
    });

    it("does not create a pty-manager connection when sessionId is missing", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      expect(ptymgrWs).toBeUndefined();
    });
  });

  describe("sessionId present", () => {
    it("connects to pty-manager WS with the correct URL", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=abc-123"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      expect(ptymgrWs).toBeDefined();
      expect(ptymgrWs.url).toBe(
        "ws://localhost:9001/session?sessionId=abc-123",
      );
    });

    it("URL-encodes the sessionId in the pty-manager connection URL", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=a%20b%20c"),
        {} as never,
        makeHead(),
        9002,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      expect(ptymgrWs.url).toContain("sessionId=a%20b%20c");
    });

    it("forwards messages from browser WS to pty-manager WS when open", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=s1"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      ptymgrWs.readyState = 1; // OPEN

      const payload = Buffer.from("hello");
      browserWs.emit("message", payload, false);

      expect(ptymgrWs.send).toHaveBeenCalledTimes(1);
      expect(ptymgrWs.send).toHaveBeenCalledWith(payload, { binary: false });
    });

    it("buffers messages before pty-manager opens and flushes them on open", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=s2"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      // ptymgrWs starts at CONNECTING — messages should be buffered.

      const msg1 = Buffer.from("first");
      const msg2 = Buffer.from("second");
      browserWs.emit("message", msg1, false);
      browserWs.emit("message", msg2, true);

      expect(ptymgrWs.send).not.toHaveBeenCalled();

      // Simulate open.
      ptymgrWs.readyState = 1; // OPEN
      ptymgrWs.emit("open");

      expect(ptymgrWs.send).toHaveBeenCalledTimes(2);
      expect(ptymgrWs.send).toHaveBeenNthCalledWith(1, msg1, { binary: false });
      expect(ptymgrWs.send).toHaveBeenNthCalledWith(2, msg2, { binary: true });
    });

    it("forwards messages from pty-manager WS to browser WS", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=s3"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      // browserWs.readyState is already OPEN from makeBrowserWs.

      const chunk = Buffer.from("output data");
      ptymgrWs.emit("message", chunk, false);

      expect(browserWs.send).toHaveBeenCalledTimes(1);
      expect(browserWs.send).toHaveBeenCalledWith(chunk, { binary: false });
    });

    it("does not forward pty-manager messages when browser WS is not open", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=s3b"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      browserWs.readyState = 3; // CLOSED

      ptymgrWs.emit("message", Buffer.from("late data"), false);

      expect(browserWs.send).not.toHaveBeenCalled();
    });

    it("closes browser WS when pty-manager WS closes", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=s4"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      ptymgrWs.emit("close");

      expect(browserWs.close).toHaveBeenCalledTimes(1);
    });

    it("sends error message to browser WS and closes it on pty-manager error", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=s5"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      ptymgrWs.emit("error", new Error("connect ECONNREFUSED"));

      expect(browserWs.send).toHaveBeenCalledTimes(1);
      const msg = JSON.parse(browserWs.send.mock.calls[0][0] as string) as {
        type: string;
        message: string;
      };
      expect(msg.type).toBe("error");
      expect(msg.message).toContain("ECONNREFUSED");
      expect(browserWs.close).toHaveBeenCalledTimes(1);
    });

    it("does not send error to browser WS when it is not open at error time", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=s5b"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      browserWs.readyState = 3; // CLOSED

      ptymgrWs.emit("error", new Error("gone"));

      // send not called because browserWs is not OPEN.
      expect(browserWs.send).not.toHaveBeenCalled();
      // close is still called regardless.
      expect(browserWs.close).toHaveBeenCalledTimes(1);
    });

    it("closes pty-manager WS when browser WS closes", () => {
      const browserWs = makeBrowserWs();
      const wss = makeMockWss(browserWs);

      handleTerminalUpgrade(
        wss as never,
        makeReq("/ws/terminal?sessionId=s6"),
        {} as never,
        makeHead(),
        9001,
      );

      const ptymgrWs = getPtymgrWs(browserWs);
      browserWs.emit("close");

      expect(ptymgrWs.close).toHaveBeenCalledTimes(1);
    });
  });
});
