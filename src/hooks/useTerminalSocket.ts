"use client";

import { useEffect } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";

import type { ClaudeStatus } from "./useTerminalSocket.types";

export const useTerminalSocket = (
  xterm: XTerm | null,
  sessionId: string,
  onStatus?: (status: ClaudeStatus) => void,
) => {
  useEffect(() => {
    if (!xterm) {
      return;
    }

    onStatus?.("connecting");

    const ws = new WebSocket(
      `ws://${window.location.host}/ws/terminal?sessionId=${encodeURIComponent(sessionId)}`,
    );
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(
        JSON.stringify({ type: "resize", cols: xterm.cols, rows: xterm.rows }),
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        xterm.write(new Uint8Array(event.data));
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
          xterm.clear();
          xterm.write(Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0)));
        } else if (msg.type === "status" && msg.value) {
          onStatus?.(msg.value);
        } else if (msg.type === "exit") {
          onStatus?.("exited");
          xterm.write(
            "\r\n\x1b[33mSession ended. Reload to restart.\x1b[0m\r\n",
          );
        } else if (msg.type === "error") {
          xterm.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`);
        }
      } catch {
        // not JSON — ignore
      }
    };

    ws.onclose = () => {
      onStatus?.("disconnected");
      xterm.write("\r\n\x1b[33mDisconnected.\x1b[0m\r\n");
    };

    const dataDisposable = xterm.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const resizeDisposable = xterm.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    return () => {
      dataDisposable.dispose();
      resizeDisposable.dispose();
      ws.onclose = null;
      ws.close();
    };
  }, [xterm, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
};
