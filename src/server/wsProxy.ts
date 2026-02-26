/**
 * wsProxy.ts — Terminal WebSocket proxy.
 *
 * Upgrades an incoming HTTP upgrade request to a WebSocket connection and
 * bridges it to the pty-manager WebSocket server.
 */

import { WebSocket } from "ws";
import type { WebSocketServer } from "ws";

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { parse } from "node:url";

/**
 * Handle an HTTP upgrade request for the `/ws/terminal` endpoint.
 *
 * Completes the WebSocket handshake via `wss`, then proxies all messages
 * between the browser WebSocket and the pty-manager WebSocket running on
 * `ptymgrPort`.  Messages that arrive before the upstream connection opens
 * are queued and flushed once it does.
 */
export function handleTerminalUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  ptymgrPort: number,
): void {
  const url = parse(req.url ?? "", true);

  wss.handleUpgrade(req, socket, head, (browserWs) => {
    const sessionId = url.query["sessionId"] as string | undefined;
    if (!sessionId) {
      browserWs.send(
        JSON.stringify({ type: "error", message: "Missing sessionId" }),
      );
      browserWs.close();
      return;
    }

    // Proxy: bridge this browser WS to the pty-manager WS.
    const ptymgrWs = new WebSocket(
      `ws://localhost:${ptymgrPort}/session?sessionId=${encodeURIComponent(sessionId)}`,
    );

    // Buffer messages that arrive before the upstream connection opens.
    const pending: Array<{ data: Buffer | string; isBinary: boolean }> = [];

    browserWs.on("message", (data, isBinary) => {
      if (ptymgrWs.readyState === WebSocket.OPEN) {
        ptymgrWs.send(data, { binary: isBinary });
      } else {
        pending.push({ data: data as Buffer | string, isBinary });
      }
    });

    ptymgrWs.on("open", () => {
      for (const { data, isBinary } of pending) {
        ptymgrWs.send(data, { binary: isBinary });
      }
      pending.length = 0;
    });

    ptymgrWs.on("message", (data, isBinary) => {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(data, { binary: isBinary });
      }
    });

    ptymgrWs.on("close", () => browserWs.close());
    ptymgrWs.on("error", (err) => {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(
          JSON.stringify({ type: "error", message: String(err) }),
        );
      }
      browserWs.close();
    });

    browserWs.on("close", () => ptymgrWs.close());
  });
}
