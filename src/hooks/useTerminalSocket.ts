"use client";

import { useEffect, useRef } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";

import type { ClaudeStatus } from "./useTerminalSocket.types";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export const useTerminalSocket = (
  xterm: XTerm | null,
  sessionId: string,
  onStatus?: (status: ClaudeStatus) => void,
) => {
  // Keep a ref so the onData/onResize handlers always see the latest xterm
  // instance without re-registering on every render.
  const xtermRef = useRef(xterm);
  xtermRef.current = xterm;

  useEffect(() => {
    if (!xterm) {
      return;
    }

    let ws: WebSocket;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let sessionExited = false;

    const connect = () => {
      if (cancelled) {
        return;
      }

      onStatus?.("connecting");

      ws = new WebSocket(
        `ws://${window.location.host}/ws/terminal?sessionId=${encodeURIComponent(sessionId)}`,
      );
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        reconnectAttempt = 0;
        const t = xtermRef.current;
        if (t) {
          ws.send(
            JSON.stringify({ type: "resize", cols: t.cols, rows: t.rows }),
          );
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        const t = xtermRef.current;
        if (!t) {
          return;
        }

        if (event.data instanceof ArrayBuffer) {
          t.write(new Uint8Array(event.data));
          return;
        }
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            code?: number;
            message?: string;
            data?: string;
            value?: ClaudeStatus;
          };
          if (msg.type === "replay" && msg.data) {
            t.clear();
            t.write(Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0)));
          } else if (msg.type === "resumed") {
            t.write(
              "\r\n\x1b[36m─── Resuming previous conversation ───\x1b[0m\r\n\r\n",
            );
          } else if (msg.type === "status" && msg.value) {
            onStatus?.(msg.value);
          } else if (msg.type === "exit") {
            sessionExited = true;
            onStatus?.("exited");
            t.write("\r\n\x1b[33mSession ended.\x1b[0m\r\n");
          } else if (msg.type === "error") {
            t.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
          }
        } catch {
          // not JSON — ignore
        }
      };

      ws.onclose = () => {
        if (cancelled || sessionExited) {
          return;
        }
        onStatus?.("disconnected");
        const t = xtermRef.current;
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** reconnectAttempt,
          RECONNECT_MAX_MS,
        );
        reconnectAttempt++;
        const secs = Math.round(delay / 1000);
        t?.write(
          `\r\n\x1b[33mDisconnected. Reconnecting in ${secs}s\u2026\x1b[0m\r\n`,
        );
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    const dataDisposable = xterm.onData((data) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const resizeDisposable = xterm.onResize(({ cols, rows }) => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      dataDisposable.dispose();
      resizeDisposable.dispose();
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [xterm, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
};
