/**
 * @jest-environment node
 */
import { WebSocket } from "ws";

import { boardClients, broadcastTaskEvent } from "./boardBroadcast";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeWs(readyState: number) {
  return { readyState, send: jest.fn() } as unknown as WebSocket;
}

// ── boardBroadcast ────────────────────────────────────────────────────────────

describe("broadcastTaskEvent", () => {
  beforeEach(() => {
    boardClients.clear();
  });

  it("sends to all OPEN clients", () => {
    const ws1 = makeWs(WebSocket.OPEN);
    const ws2 = makeWs(WebSocket.OPEN);
    boardClients.add(ws1);
    boardClients.add(ws2);

    broadcastTaskEvent("task:updated", { id: "task-1" });

    const expected = JSON.stringify({
      type: "task:updated",
      data: { id: "task-1" },
    });
    expect((ws1 as { send: jest.Mock }).send).toHaveBeenCalledWith(expected);
    expect((ws2 as { send: jest.Mock }).send).toHaveBeenCalledWith(expected);
  });

  it("skips clients that are not OPEN", () => {
    const wsOpen = makeWs(WebSocket.OPEN);
    const wsClosing = makeWs(WebSocket.CLOSING);
    const wsClosed = makeWs(WebSocket.CLOSED);
    const wsConnecting = makeWs(WebSocket.CONNECTING);
    boardClients.add(wsOpen);
    boardClients.add(wsClosing);
    boardClients.add(wsClosed);
    boardClients.add(wsConnecting);

    broadcastTaskEvent("task:created", { id: "task-2" });

    expect((wsOpen as { send: jest.Mock }).send).toHaveBeenCalledTimes(1);
    expect((wsClosing as { send: jest.Mock }).send).not.toHaveBeenCalled();
    expect((wsClosed as { send: jest.Mock }).send).not.toHaveBeenCalled();
    expect((wsConnecting as { send: jest.Mock }).send).not.toHaveBeenCalled();
  });

  it("sends correct JSON: { type: event, data }", () => {
    const ws = makeWs(WebSocket.OPEN);
    boardClients.add(ws);

    const data = { id: "repo-42", name: "Test Repo" };
    broadcastTaskEvent("repo:created", data);

    expect((ws as { send: jest.Mock }).send).toHaveBeenCalledWith(
      JSON.stringify({ type: "repo:created", data }),
    );
  });

  it("does nothing when there are no clients", () => {
    // boardClients is already empty from beforeEach — just ensure no throw
    expect(() => {
      broadcastTaskEvent("task:deleted", { id: "task-99" });
    }).not.toThrow();
  });
});

// ── boardClients Set ──────────────────────────────────────────────────────────

describe("boardClients", () => {
  beforeEach(() => {
    boardClients.clear();
  });

  it("is a Set that can be added to and deleted from", () => {
    const ws = makeWs(WebSocket.OPEN);

    expect(boardClients.size).toBe(0);

    boardClients.add(ws);
    expect(boardClients.size).toBe(1);
    expect(boardClients.has(ws)).toBe(true);

    boardClients.delete(ws);
    expect(boardClients.size).toBe(0);
    expect(boardClients.has(ws)).toBe(false);
  });

  it("multiple clients can be tracked independently", () => {
    const ws1 = makeWs(WebSocket.OPEN);
    const ws2 = makeWs(WebSocket.OPEN);
    const ws3 = makeWs(WebSocket.CLOSED);

    boardClients.add(ws1);
    boardClients.add(ws2);
    boardClients.add(ws3);

    expect(boardClients.size).toBe(3);

    boardClients.delete(ws2);
    expect(boardClients.size).toBe(2);
    expect(boardClients.has(ws1)).toBe(true);
    expect(boardClients.has(ws2)).toBe(false);
    expect(boardClients.has(ws3)).toBe(true);
  });
});

// ── multiple independent broadcasts ──────────────────────────────────────────

describe("multiple independent broadcasts", () => {
  beforeEach(() => {
    boardClients.clear();
  });

  it("each broadcast sends its own distinct message", () => {
    const ws = makeWs(WebSocket.OPEN);
    boardClients.add(ws);

    broadcastTaskEvent("repo:created", { id: "r1" });
    broadcastTaskEvent("repo:deleted", { id: "r1" });
    broadcastTaskEvent("task:updated", { id: "t1", status: "done" });

    const sendMock = (ws as { send: jest.Mock }).send;
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock).toHaveBeenNthCalledWith(
      1,
      JSON.stringify({ type: "repo:created", data: { id: "r1" } }),
    );
    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({ type: "repo:deleted", data: { id: "r1" } }),
    );
    expect(sendMock).toHaveBeenNthCalledWith(
      3,
      JSON.stringify({
        type: "task:updated",
        data: { id: "t1", status: "done" },
      }),
    );
  });
});
