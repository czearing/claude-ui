/**
 * wsSessionHandler.ts — PTY-manager WebSocket connection handler.
 *
 * Handles a new WebSocket connection from the proxy: either reconnects to an
 * existing live session or spawns a fresh PTY process for a new / resumed one.
 */

import * as pty from "node-pty";
import { WebSocket } from "ws";

import {
  appendToBuffer,
  backToInProgress,
  completedSessions,
  emitStatus,
  sessions,
} from "./ptyStore";
import {
  createHookSettingsFile,
  cleanupHookSettingsDir,
} from "../utils/claudeHookSettings";
import type { SessionRegistryEntry } from "../utils/sessionRegistry";

import type { IncomingMessage } from "node:http";
import { parse } from "node:url";

/**
 * Returns true only when the user has pressed Enter (CR) — i.e. they have
 * actually submitted a prompt to Claude.
 *
 * We deliberately do NOT fire backToInProgress on every keypress.  Typing
 * individual characters (or xterm.js automatically responding to PTY queries
 * like cursor-position reports \x1b[24;80R) should not pull a task out of
 * Review; only an explicit submission should.
 *
 * Strip CSI sequences first so that sequences ending in a letter (e.g. mode
 * reports) are not confused with user-typed carriage returns.
 */
function isUserSubmit(s: string): boolean {
  // Strip all CSI sequences: ESC [ <parameter/intermediate bytes> <final byte>
  // eslint-disable-next-line no-control-regex
  const stripped = s.replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, "");
  return stripped.includes("\r");
}

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
    // Check for a completed handover session whose output should be replayed
    // before spawning --continue for the interactive follow-up session.
    let priorOutput: Buffer | null = null;
    if (completedSessions.has(sessionId)) {
      const finalOutput = completedSessions.get(sessionId)!;
      const reg = sessionRegistry.get(sessionId);
      if (!reg) {
        // Truly ended — no registry entry, replay output and close.
        if (finalOutput.length > 0) {
          ws.send(
            JSON.stringify({
              type: "replay",
              data: finalOutput.toString("base64"),
            }),
          );
        }
        ws.send(JSON.stringify({ type: "status", value: "exited" }));
        ws.send(JSON.stringify({ type: "exit", code: 0 }));
        ws.close();
        return;
      }
      // Registry entry exists — replay prior output then spawn --continue.
      priorOutput = finalOutput;
      completedSessions.delete(sessionId);
    }

    // New or resumed session: spawn pty
    const registryEntry = sessionRegistry.get(sessionId);
    const sessionCwd = registryEntry?.cwd ?? process.cwd();
    // Use --resume <claudeSessionId> when available to continue the exact
    // handover conversation.  Fall back to a fresh interactive session when
    // claudeSessionId is absent — never use --continue (it would pick up the
    // developer's own active session rather than the handover task's one).
    const spawnArgs = ["--dangerously-skip-permissions"];
    const useResume = Boolean(registryEntry?.claudeSessionId);
    if (useResume) {
      spawnArgs.push("--resume", registryEntry!.claudeSessionId!);
    }

    // Unset CLAUDECODE so nested Claude instances are not blocked by the
    // "cannot be launched inside another Claude Code session" guard.
    const { CLAUDECODE: _cc, ...spawnEnv } = process.env as Record<
      string,
      string
    >;
    const SERVER_PORT = process.env.SERVER_PORT ?? "3000";
    const settingsFile = createHookSettingsFile(sessionId, SERVER_PORT);
    spawnArgs.push("--settings", settingsFile);
    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(command, spawnArgs, {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: sessionCwd,
        env: { ...spawnEnv, CLAUDE_CODE_UI_SESSION_ID: sessionId },
        useConptyDll: process.platform === "win32",
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", message: String(err) }));
      ws.close();
      return;
    }

    // Replay prior handover output so user has full context before --continue
    if (priorOutput && priorOutput.length > 0) {
      ws.send(
        JSON.stringify({
          type: "replay",
          data: priorOutput.toString("base64"),
        }),
      );
    }

    // Track in registry so the session survives future server restarts
    if (!registryEntry) {
      sessionRegistry.set(sessionId, {
        id: sessionId,
        cwd: process.cwd(),
        createdAt: new Date().toISOString(),
      });
      void saveSessionRegistry();
    } else if (useResume) {
      // Notify the client that --resume was used to restore the conversation
      ws.send(JSON.stringify({ type: "resumed" }));
    }

    entry = {
      pty: ptyProcess,
      outputBuffer: [],
      bufferSize: 0,
      activeWs: ws,
      currentStatus: "connecting",
      idleTimer: null,
    };
    sessions.set(sessionId, entry);
    emitStatus(ws, "connecting");

    // Simple PTY handlers
    ptyProcess.onData((data) => {
      const chunk = Buffer.from(data);
      const e = sessions.get(sessionId);
      if (!e) {
        return;
      }
      appendToBuffer(e, chunk);
      if (e.activeWs?.readyState === WebSocket.OPEN) {
        e.activeWs.send(chunk);
      }
    });
    ptyProcess.onExit(({ exitCode }) => {
      const e = sessions.get(sessionId);
      if (e) {
        if (e.idleTimer !== null) {
          clearTimeout(e.idleTimer);
        }
        e.currentStatus = "exited";
        if (e.activeWs?.readyState === WebSocket.OPEN) {
          e.activeWs.send(JSON.stringify({ type: "exit", code: exitCode }));
          e.activeWs.close();
        }
        // Store final output for replay if user reconnects
        completedSessions.set(sessionId, Buffer.concat(e.outputBuffer));
      }
      sessions.delete(sessionId);
      cleanupHookSettingsDir(sessionId);
      // Keep registry entry so --continue can always be spawned as a fallback
      // if the interactive session dies.  Registry entries are only cleared by
      // explicit killSession calls (user marks task Done or uses Recall).
    });
  }

  ws.on("message", (data, isBinary) => {
    const e = sessions.get(sessionId);
    if (!e) {
      return;
    }
    if (isBinary) {
      const str = Buffer.from(data as ArrayBuffer).toString();
      if (isUserSubmit(str)) {
        backToInProgress(sessionId);
      }
      e.pty.write(str);
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
      if (isUserSubmit(text)) {
        backToInProgress(sessionId);
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
