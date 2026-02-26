/**
 * wsSessionHandler.ts — PTY-manager WebSocket connection handler.
 *
 * Handles a new WebSocket connection from the proxy: either reconnects to an
 * existing live session or spawns a fresh PTY process for a new / resumed one.
 */

import * as pty from "node-pty";
import type { WebSocket } from "ws";

import { attachTerminalHandlers } from "./ptyHandlers";
import { emitStatus, sessions } from "./ptyStore";
import type { SessionRegistryEntry } from "../utils/sessionRegistry";

import type { IncomingMessage } from "node:http";
import { parse } from "node:url";

/**
 * Handle an incoming WebSocket connection on the pty-manager server.
 *
 * @param ws                  - The WebSocket for this client connection.
 * @param req                 - The originating HTTP upgrade request.
 * @param sessionRegistry     - Live session-registry map (owned by caller).
 * @param saveSessionRegistry - Async callback to persist the registry to disk.
 * @param command             - The Claude CLI executable path to spawn.
 */
export function handleWsConnection(
  ws: WebSocket,
  req: IncomingMessage,
  sessionRegistry: Map<string, SessionRegistryEntry>,
  saveSessionRegistry: () => Promise<void>,
  command: string,
): void {
  const url = parse(req.url ?? "", true);
  const sessionId = url.query["sessionId"] as string | undefined;

  if (!sessionId) {
    ws.send(JSON.stringify({ type: "error", message: "Missing sessionId" }));
    ws.close();
    return;
  }

  let entry = sessions.get(sessionId);

  if (entry) {
    // Reconnect: attach this WS, replay buffer, resync status
    entry.activeWs = ws;
    if (entry.outputBuffer.length > 0) {
      const replay = Buffer.concat(entry.outputBuffer);
      ws.send(
        JSON.stringify({ type: "replay", data: replay.toString("base64") }),
      );
    }
    emitStatus(ws, entry.currentStatus);
  } else {
    // New or resumed session: spawn pty
    const registryEntry = sessionRegistry.get(sessionId);
    const sessionCwd = registryEntry?.cwd ?? process.cwd();
    const spawnArgs = registryEntry
      ? ["--dangerously-skip-permissions", "--continue"]
      : ["--dangerously-skip-permissions"];

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(command, spawnArgs, {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: sessionCwd,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: String(err) }));
      ws.close();
      return;
    }

    // Track in registry so the session survives future server restarts
    if (!registryEntry) {
      sessionRegistry.set(sessionId, {
        id: sessionId,
        cwd: process.cwd(),
        createdAt: new Date().toISOString(),
      });
      void saveSessionRegistry();
    } else {
      // Notify the client that --continue was used to resume the conversation
      ws.send(JSON.stringify({ type: "resumed" }));
    }

    entry = {
      pty: ptyProcess,
      outputBuffer: [],
      bufferSize: 0,
      activeWs: ws,
      currentStatus: "connecting",
      idleTimer: null,
      handoverPhase: null,
      handoverSpec: "",
      specSentAt: 0,
      hadMeaningfulActivity: false,
      lastMeaningfulStatus: null,
    };
    sessions.set(sessionId, entry);
    emitStatus(ws, "connecting");

    attachTerminalHandlers(ptyProcess, sessionId);
  }

  ws.on("message", (data, isBinary) => {
    const e = sessions.get(sessionId);
    if (!e) {
      return;
    }
    if (isBinary) {
      e.pty.write(Buffer.from(data as ArrayBuffer).toString());
    } else {
      const text = (data as Buffer).toString("utf8");
      try {
        const msg = JSON.parse(text) as {
          type: string;
          cols?: number;
          rows?: number;
        };
        if (msg.type === "resize" && msg.cols && msg.rows) {
          e.pty.resize(msg.cols, msg.rows);
          return;
        }
      } catch {
        // not JSON — write raw to PTY
      }
      e.pty.write(text);
    }
  });

  ws.on("close", () => {
    const e = sessions.get(sessionId);
    if (e) {
      e.activeWs = null;
      // Do NOT kill pty — session stays alive
    }
  });
}
