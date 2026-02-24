import { renderHook } from "@testing-library/react";

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

// WebSocket mock
class MockWebSocket {
  static OPEN = 1;
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
    MockWebSocket.lastInstance = this;
  }
  static lastInstance: MockWebSocket;
}

Object.defineProperty(window, "WebSocket", { value: MockWebSocket, writable: true });
// jsdom default URL is http://localhost/ so window.location.host === "localhost"

describe("useTerminalSocket", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("connects to the terminal WS endpoint with sessionId in the URL", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    expect(MockWebSocket.lastInstance.url).toBe(
      "ws://localhost/ws/terminal?sessionId=session-abc"
    );
  });

  it("sends a resize message on open", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    MockWebSocket.lastInstance.onopen?.();

    expect(MockWebSocket.lastInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "resize", cols: 80, rows: 24 })
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
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
    );
  });

  it("does not open WebSocket when xterm is null", () => {
    const urlBefore = MockWebSocket.lastInstance?.url;
    renderHook(() => useTerminalSocket(null, "session-abc"));

    // No new instance created — lastInstance URL unchanged
    expect(MockWebSocket.lastInstance?.url).toBe(urlBefore);
  });

  it("calls onStatus('connecting') immediately when xterm is provided", () => {
    const onStatus = jest.fn();
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc", onStatus));

    expect(onStatus).toHaveBeenCalledWith("connecting");
  });

  it("calls onStatus with the value from a status frame", () => {
    const onStatus = jest.fn();
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc", onStatus));

    MockWebSocket.lastInstance.onmessage?.({
      data: JSON.stringify({ type: "status", value: "busy" }),
    } as MessageEvent);

    expect(onStatus).toHaveBeenCalledWith("busy");
  });

  it("calls onStatus('exited') on exit message", () => {
    const onStatus = jest.fn();
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc", onStatus));

    MockWebSocket.lastInstance.onmessage?.({
      data: JSON.stringify({ type: "exit" }),
    } as MessageEvent);

    expect(onStatus).toHaveBeenCalledWith("exited");
  });

  it("calls onStatus('disconnected') on WS close", () => {
    const onStatus = jest.fn();
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc", onStatus));

    MockWebSocket.lastInstance.onclose?.();

    expect(onStatus).toHaveBeenCalledWith("disconnected");
  });
});
