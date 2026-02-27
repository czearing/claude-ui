/**
 * pty-manager.ts — Long-lived PTY session manager (trimmed)
 *
 * Runs as a standalone HTTP + WebSocket server on PTY_MANAGER_PORT (default
 * 3001).  Owns all node-pty processes so they survive hot-reloads of the
 * main Next.js server (server.ts).
 *
 * HTTP routes
 *   POST   /sessions              Spawn a new PTY for a task handover
 *   DELETE /sessions/:id          Kill a session and remove from registry
 *   POST   /sessions/:id/kill     Kill a session (becomingDone / recall path)
 *
 * WebSocket
 *   WS /session?sessionId=xxx     Stream PTY I/O for a session
 *
 * Environment variables
 *   PTY_MANAGER_PORT  Port to listen on (default: 3001)
 *   SERVER_PORT       Port of the main Next.js server for callbacks (default: 3000)
 */

import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

import {
  appendToBuffer,
  completedSessions,
  sessions,
  killSession,
} from "./src/server/ptyStore";
import type { SessionEntry } from "./src/server/ptyStore";
import { handleWsConnection } from "./src/server/wsSessionHandler";
import {
  createHookSettingsFile,
  cleanupHookSettingsDir,
} from "./src/utils/claudeHookSettings";
import { readBody } from "./src/utils/readBody";
import {
  loadRegistry,
  saveRegistry,
  type SessionRegistryEntry,
} from "./src/utils/sessionRegistry";

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { parse } from "node:url";

// ─── Constants ────────────────────────────────────────────────────────────────

const PTY_MANAGER_PORT = parseInt(process.env.PTY_MANAGER_PORT ?? "3001", 10);
const command = process.platform === "win32" ? "claude.cmd" : "claude";
const SESSIONS_REGISTRY_FILE = join(process.cwd(), "sessions-registry.json");

// ─── Session Registry (persistent across server restarts) ────────────────────

const sessionRegistry = new Map<string, SessionRegistryEntry>();

async function loadSessionRegistry(): Promise<void> {
  const loaded = await loadRegistry(SESSIONS_REGISTRY_FILE);
  for (const [k, v] of loaded) {
    sessionRegistry.set(k, v);
  }
}

const saveSessionRegistry = (): Promise<void> =>
  saveRegistry(SESSIONS_REGISTRY_FILE, sessionRegistry);

// ─── HTTP request handler ─────────────────────────────────────────────────────

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsedUrl = parse(req.url ?? "", true);
  const pathname = parsedUrl.pathname ?? "";

  try {
    // GET /sessions — list live session IDs for server startup recovery
    if (req.method === "GET" && pathname === "/sessions") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions: [...sessions.keys()] }));
      return;
    }

    // POST /sessions — Spawn a new PTY for a task handover
    if (req.method === "POST" && pathname === "/sessions") {
      const body = await readBody(req);
      const sessionId =
        typeof body["sessionId"] === "string" ? body["sessionId"] : null;
      const spec = typeof body["spec"] === "string" ? body["spec"] : null;
      const cwd = typeof body["cwd"] === "string" ? body["cwd"] : process.cwd();

      if (!sessionId || spec === null) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "sessionId and spec are required" }));
        return;
      }

      let ptyProcess: pty.IPty;
      try {
        // Spawn Claude in print mode (-p) with the spec as the prompt.
        // This avoids the need to inject text into an interactive PTY — which
        // is unreliable on Windows ConPTY — while still streaming output to
        // the terminal view.  When Claude finishes, the Stop hook fires to
        // advance the task to Review, the process exits, and the WS client
        // reconnects to trigger a fresh interactive session for follow-up.
        // Unset CLAUDECODE so nested Claude instances are not blocked by the
        // "cannot be launched inside another Claude Code session" guard.
        const { CLAUDECODE: _cc, ...spawnEnv } = process.env as Record<
          string,
          string
        >;
        const SERVER_PORT = process.env.SERVER_PORT ?? "3000";
        const settingsFile = createHookSettingsFile(sessionId, SERVER_PORT);
        ptyProcess = pty.spawn(
          command,
          [
            "--dangerously-skip-permissions",
            "--settings",
            settingsFile,
            "-p",
            spec,
          ],
          {
            name: "xterm-color",
            cols: 80,
            rows: 24,
            cwd,
            env: { ...spawnEnv, CLAUDE_CODE_UI_SESSION_ID: sessionId },
          },
        );
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
        return;
      }

      const entry: SessionEntry = {
        pty: ptyProcess,
        outputBuffer: [],
        bufferSize: 0,
        activeWs: null,
        currentStatus: "connecting",
        idleTimer: null,
      };
      sessions.set(sessionId, entry);
      sessionRegistry.set(sessionId, {
        id: sessionId,
        cwd,
        createdAt: new Date().toISOString(),
      });
      void saveSessionRegistry();

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
      ptyProcess.onExit(({ exitCode: _exitCode }) => {
        const e = sessions.get(sessionId);
        if (e) {
          if (e.idleTimer !== null) {
            clearTimeout(e.idleTimer);
          }
          e.currentStatus = "exited";
          if (e.activeWs?.readyState === WebSocket.OPEN) {
            // Close WS without sending an "exit" message so the client
            // reconnects and wsSessionHandler can spawn a fresh interactive
            // session for follow-up.
            e.activeWs.close();
          }
        }
        const finalBuffer = e ? Buffer.concat(e.outputBuffer) : Buffer.alloc(0);
        sessions.delete(sessionId);
        completedSessions.set(sessionId, finalBuffer);
        cleanupHookSettingsDir(sessionId);
        // Keep registry entry so wsSessionHandler knows the cwd when the client reconnects.
        // The file watcher in server.ts handles task status updates when Claude
        // moves files between folders — no advanceToReview call needed here.
      });

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId }));
      return;
    }

    // DELETE /sessions/:id — Kill and remove a session from registry
    if (req.method === "DELETE" && pathname.startsWith("/sessions/")) {
      const id = pathname.slice("/sessions/".length);
      killSession(id, sessionRegistry, saveSessionRegistry);
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /sessions/:id/kill — Kill without full delete (becomingDone / recall)
    if (
      req.method === "POST" &&
      pathname.startsWith("/sessions/") &&
      pathname.endsWith("/kill")
    ) {
      const id = pathname.slice("/sessions/".length, -"/kill".length);
      killSession(id, sessionRegistry, saveSessionRegistry);
      res.writeHead(204);
      res.end();
      return;
    }

    // 404 for everything else
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (err) {
    console.error("pty-manager request error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}

// ─── Server startup ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadSessionRegistry();

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = parse(req.url ?? "", true);
    if (url.pathname === "/session") {
      wss.handleUpgrade(req, socket, head, (ws) =>
        wss.emit("connection", ws, req),
      );
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws, req) =>
    handleWsConnection(ws, req, sessionRegistry, saveSessionRegistry, command),
  );

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `pty-manager: port ${PTY_MANAGER_PORT} already in use. Kill the existing process and retry.`,
      );
    } else {
      console.error("pty-manager server error:", err);
    }
    process.exit(1);
  });

  server.listen(PTY_MANAGER_PORT, () => {
    console.error(`pty-manager ready on http://localhost:${PTY_MANAGER_PORT}`);
  });
}

main().catch((err: unknown) => {
  console.error("pty-manager failed to start:", err);
  process.exit(1);
});
