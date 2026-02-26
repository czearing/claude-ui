import { act, renderHook } from "@testing-library/react";

import { useTerminalSocket } from "./useTerminalSocket";

// Minimal xterm mock
const mockWrite = jest.fn();
const mockClear = jest.fn();
const mockOnData = jest.fn().mockReturnValue({ dispose: jest.fn() });
const mockOnResize = jest.fn().mockReturnValue({ dispose: jest.fn() });
const mockXterm = {
  write: mockWrite,
  clear: mockClear,
  onData: mockOnData,
  onResize: mockOnResize,
  cols: 80,
  rows: 24,
};

// WebSocket mock — keeps an instance registry so tests can retrieve any WS
class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn();
  url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  static get lastInstance() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
  }
}

Object.defineProperty(window, "WebSocket", {
  value: MockWebSocket,
  writable: true,
});
// jsdom default URL is http://localhost/ so window.location.host === "localhost"

describe("useTerminalSocket", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("connects to the terminal WS endpoint with sessionId in the URL", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    expect(MockWebSocket.lastInstance.url).toBe(
      "ws://localhost/ws/terminal?sessionId=session-abc",
    );
  });

  it("sends a resize message on open", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    MockWebSocket.lastInstance.onopen?.();

    expect(MockWebSocket.lastInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "resize", cols: 80, rows: 24 }),
    );
  });

  it("writes binary ArrayBuffer data directly to xterm", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
    MockWebSocket.lastInstance.onmessage?.({ data: buffer } as MessageEvent);

    expect(mockWrite).toHaveBeenCalledWith(new Uint8Array(buffer));
  });

  it("clears terminal and writes replay data on replay message", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    // "Hello" base64-encoded
    const encoded = btoa("Hello");
    MockWebSocket.lastInstance.onmessage?.({
      data: JSON.stringify({ type: "replay", data: encoded }),
    } as MessageEvent);

    expect(mockClear).toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalledWith(
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
    );
  });

  it("writes a 'resuming' notice on resumed message", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    MockWebSocket.lastInstance.onmessage?.({
      data: JSON.stringify({ type: "resumed" }),
    } as MessageEvent);

    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("Resuming previous conversation"),
    );
  });

  it("does not open WebSocket when xterm is null", () => {
    const countBefore = MockWebSocket.instances.length;
    renderHook(() => useTerminalSocket(null, "session-abc"));

    expect(MockWebSocket.instances.length).toBe(countBefore);
  });

  it("calls onStatus('connecting') immediately when xterm is provided", () => {
    const onStatus = jest.fn();
    renderHook(() =>
      useTerminalSocket(mockXterm as never, "session-abc", onStatus),
    );

    expect(onStatus).toHaveBeenCalledWith("connecting");
  });

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

  it("calls onStatus('exited') on exit message", () => {
    const onStatus = jest.fn();
    renderHook(() =>
      useTerminalSocket(mockXterm as never, "session-abc", onStatus),
    );

    MockWebSocket.lastInstance.onmessage?.({
      data: JSON.stringify({ type: "exit" }),
    } as MessageEvent);

    expect(onStatus).toHaveBeenCalledWith("exited");
  });

  it("writes 'Session ended.' to terminal on exit message", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    MockWebSocket.lastInstance.onmessage?.({
      data: JSON.stringify({ type: "exit" }),
    } as MessageEvent);

    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("Session ended."),
    );
  });

  it("does not reconnect after an exit message closes the WebSocket", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    // Receive exit message — marks session as cleanly exited
    act(() => {
      MockWebSocket.lastInstance.onmessage?.({
        data: JSON.stringify({ type: "exit" }),
      } as MessageEvent);
    });

    // WebSocket closes after the server sends exit
    act(() => {
      MockWebSocket.lastInstance.onclose?.();
      jest.advanceTimersByTime(5_000);
    });

    // Still only one WebSocket — no reconnect should have been scheduled
    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("calls onStatus('disconnected') and schedules reconnect on WS close", () => {
    const onStatus = jest.fn();
    renderHook(() =>
      useTerminalSocket(mockXterm as never, "session-abc", onStatus),
    );

    const firstWs = MockWebSocket.lastInstance;
    act(() => {
      firstWs.onclose?.();
    });

    expect(onStatus).toHaveBeenCalledWith("disconnected");

    // Advance past the 1s reconnect delay
    act(() => {
      jest.advanceTimersByTime(1_500);
    });

    // A new WS should have been created
    expect(MockWebSocket.instances.length).toBe(2);
    expect(MockWebSocket.lastInstance.url).toBe(
      "ws://localhost/ws/terminal?sessionId=session-abc",
    );
  });

  it("does not reconnect after component unmounts", () => {
    const { unmount } = renderHook(() =>
      useTerminalSocket(mockXterm as never, "session-abc"),
    );

    const firstWs = MockWebSocket.lastInstance;

    // Simulate WS close coming in right before unmount
    act(() => {
      firstWs.onclose?.();
    });

    unmount();

    // Advance time — should NOT create a second WS
    act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(MockWebSocket.instances.length).toBe(1);
  });

  it("uses exponential backoff on repeated disconnects", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    // First disconnect → 1s delay
    act(() => {
      MockWebSocket.lastInstance.onclose?.();
      jest.advanceTimersByTime(1_000);
    });

    // Second disconnect → 2s delay
    act(() => {
      MockWebSocket.lastInstance.onclose?.();
      jest.advanceTimersByTime(2_000);
    });

    // Third disconnect → 4s delay (need >4s to fire)
    act(() => {
      MockWebSocket.lastInstance.onclose?.();
      jest.advanceTimersByTime(4_000);
    });

    // Three reconnect attempts = 4 total WS instances (original + 3 reconnects)
    expect(MockWebSocket.instances.length).toBe(4);
  });

  it("writes error message to xterm when an error frame is received", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    MockWebSocket.lastInstance.onmessage?.({
      data: JSON.stringify({ type: "error", message: "oops" }),
    } as MessageEvent);

    expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining("oops"));
  });

  it("sends a resize message when xterm fires onResize", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    const ws = MockWebSocket.lastInstance;
    // Simulate WebSocket opening so readyState is OPEN
    ws.onopen?.();

    // Retrieve the onResize callback registered with xterm
    const onResizeCallback = mockOnResize.mock.calls[0][0] as (dims: {
      cols: number;
      rows: number;
    }) => void;
    onResizeCallback({ cols: 120, rows: 40 });

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "resize", cols: 120, rows: 40 }),
    );
  });

  it("does not send data when WebSocket is not OPEN", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    const ws = MockWebSocket.lastInstance;
    // Set readyState to CONNECTING (0) — not OPEN (1)
    ws.readyState = 0;

    // Retrieve the onData callback captured by the mock and invoke it
    const onDataCallback = mockOnData.mock.calls[0][0] as (
      data: string,
    ) => void;
    onDataCallback("hello");

    expect(ws.send).not.toHaveBeenCalled();
  });
});
