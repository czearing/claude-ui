/**
 * pty-manager.ts — Long-lived PTY session manager
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
  parseClaudeStatus,
  type ParsedStatus,
} from "./src/utils/parseClaudeStatus";
import {
  loadRegistry,
  saveRegistry,
  type SessionRegistryEntry,
} from "./src/utils/sessionRegistry";

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { parse } from "node:url";

// ─── Constants ───────────────────────────────────────────────────────────────

const PTY_MANAGER_PORT = parseInt(process.env.PTY_MANAGER_PORT ?? "3001", 10);

const command = process.platform === "win32" ? "claude.cmd" : "claude";

const BUFFER_CAP = 500 * 1024; // 500 KB rolling buffer per session

// Window after writing the spec to the PTY during which output is treated as
// echo/startup noise rather than meaningful Claude activity.  Any onData event
// that fires more than this many ms after spec injection is counted as
// "meaningful activity", which gates the waiting → Review transition.
const SPEC_ECHO_WINDOW_MS = 500;

// How long the PTY must be silent before we treat it as "waiting for input".
// Must be longer than Claude's longest internal API-call pause (~3 s observed)
// to avoid false-positives during processing gaps.
const SESSION_IDLE_MS = 5000;

// ─── Types ───────────────────────────────────────────────────────────────────

type ClaudeStatus =
  | "connecting"
  | "thinking"
  | "typing"
  | "waiting"
  | "exited"
  | "disconnected";

type HandoverPhase = "spec_sent" | "done";

type SessionEntry = {
  pty: pty.IPty;
  outputBuffer: Buffer[];
  bufferSize: number;
  activeWs: WebSocket | null;
  currentStatus: ClaudeStatus;
  idleTimer: ReturnType<typeof setTimeout> | null;
  // null for non-handover sessions
  handoverPhase: HandoverPhase | null;
  handoverSpec: string;
  specSentAt: number;
  hadMeaningfulActivity: boolean;
  /** Last non-null status from parseClaudeStatus. Used to distinguish
   *  tool-use silences (last=thinking) from response-complete silences
   *  (last=typing) so advanceToReview only fires after a real response. */
  lastMeaningfulStatus: ParsedStatus | null;
};

// ─── In-memory session store ──────────────────────────────────────────────────

const sessions = new Map<string, SessionEntry>();

// ─── Session Registry (persistent across server restarts) ────────────────────

const SESSIONS_REGISTRY_FILE = join(process.cwd(), "sessions-registry.json");

const sessionRegistry = new Map<string, SessionRegistryEntry>();

async function loadSessionRegistry(): Promise<void> {
  const loaded = await loadRegistry(SESSIONS_REGISTRY_FILE);
  for (const [k, v] of loaded) {
    sessionRegistry.set(k, v);
  }
}

const saveSessionRegistry = (): Promise<void> =>
  saveRegistry(SESSIONS_REGISTRY_FILE, sessionRegistry);

// ─── Buffer / status helpers ─────────────────────────────────────────────────

function appendToBuffer(entry: SessionEntry, chunk: Buffer): void {
  entry.outputBuffer.push(chunk);
  entry.bufferSize += chunk.byteLength;
  while (entry.bufferSize > BUFFER_CAP && entry.outputBuffer.length > 1) {
    const removed = entry.outputBuffer.shift()!;
    entry.bufferSize -= removed.byteLength;
  }
}

function emitStatus(ws: WebSocket | null, status: ClaudeStatus): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "status", value: status }));
  }
}

/**
 * Schedule a "waiting" status transition after PTY silence.
 *
 * Called on every onData chunk. Resets the timer so it only fires after
 * SESSION_IDLE_MS ms of continuous silence — long enough to outlast
 * Claude's internal API-call pauses while still detecting when Claude
 * actually returns to its input prompt.
 */
function scheduleIdleStatus(entry: SessionEntry, sessionId: string): void {
  if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer);
  }
  entry.idleTimer = setTimeout(() => {
    const e = sessions.get(sessionId);
    if (!e) {
      return;
    }
    e.idleTimer = null;
    if (e.currentStatus !== "waiting") {
      e.currentStatus = "waiting";
      emitStatus(e.activeWs, "waiting");
    }
    // Only advance when:
    //  - hadMeaningfulActivity: we saw the thinking spinner (Claude actually
    //    processed the spec), guarding against startup splash text that also
    //    looks like typing
    //  - lastMeaningfulStatus === "typing": silence followed streamed response,
    //    not a tool-use gap (thinking → silence = bash/file/API still running)
    if (
      e.handoverPhase === "spec_sent" &&
      e.hadMeaningfulActivity &&
      e.lastMeaningfulStatus === "typing"
    ) {
      e.handoverPhase = "done";
      advanceToReview(sessionId);
    }
  }, SESSION_IDLE_MS);
}

/**
 * Callback to server.ts to advance a task to "Review" status.
 *
 * The actual task-mutation logic lives in server.ts (which owns tasks.json
 * and the board WebSocket broadcast).  We call back over HTTP so that
 * pty-manager.ts stays stateless with respect to tasks.
 */
function advanceToReview(sessionId: string): void {
  const SERVER_PORT = process.env.SERVER_PORT ?? "3000";
  void fetch(
    `http://localhost:${SERVER_PORT}/api/internal/sessions/${sessionId}/advance-to-review`,
    { method: "POST" },
  ).catch(() => {
    // server may not be running yet or restarting — safe to swallow
  });
}

// ─── Kill helper (shared by DELETE and POST /kill) ───────────────────────────

function killSession(id: string): void {
  const entry = sessions.get(id);
  if (entry) {
    if (entry.idleTimer !== null) {
      clearTimeout(entry.idleTimer);
    }
    entry.activeWs = null;
    entry.pty.kill();
    sessions.delete(id);
  }
  sessionRegistry.delete(id);
  void saveSessionRegistry();
}

// ─── HTTP body helper ────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}") as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// ─── Spawn helpers ────────────────────────────────────────────────────────────

/**
 * Attach the standard onData / onExit handlers to a handover PTY process.
 * These are identical to the server.ts handover onData/onExit handlers.
 */
function attachHandoverHandlers(
  ptyProcess: pty.IPty,
  sessionId: string,
): void {
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

    const parsed = parseClaudeStatus(data);
    if (parsed !== null) {
      e.lastMeaningfulStatus = parsed;
      if (parsed !== e.currentStatus) {
        e.currentStatus = parsed;
        emitStatus(e.activeWs, parsed);
      }
    }

    // ⎿ prefix (tool results, "Interrupted" message, etc.) never appears in
    // the startup splash, so it is a safe meaningful-activity signal with NO
    // time gate — even if the interrupt fires within the first 500 ms we must
    // honour it.
    if (
      e.handoverPhase === "spec_sent" &&
      !e.hadMeaningfulActivity &&
      data.includes("⎿")
    ) {
      e.hadMeaningfulActivity = true;
    }

    // Thinking spinner: gate behind SPEC_ECHO_WINDOW_MS because spinner chars
    // can appear in startup noise before Claude actually processes the spec.
    if (
      e.handoverPhase === "spec_sent" &&
      !e.hadMeaningfulActivity &&
      parsed === "thinking" &&
      Date.now() - e.specSentAt > SPEC_ECHO_WINDOW_MS
    ) {
      e.hadMeaningfulActivity = true;
    }

    // Fast path: ❯ prompt detected = Claude is done (task complete or
    // question asked). Advance to Review immediately without waiting for
    // the idle timer to fire.
    if (
      parsed === "waiting" &&
      e.handoverPhase === "spec_sent" &&
      e.hadMeaningfulActivity
    ) {
      if (e.idleTimer !== null) {
        clearTimeout(e.idleTimer);
        e.idleTimer = null;
      }
      e.handoverPhase = "done";
      advanceToReview(sessionId);
      return;
    }

    // Fallback: schedule waiting detection after PTY silence
    scheduleIdleStatus(e, sessionId);
  });

  ptyProcess.onExit(({ exitCode }) => {
    const e = sessions.get(sessionId);
    // Use explicit undefined check: `undefined !== null` would
    // spuriously set isHandover=true when the session was already
    // removed (e.g. by recall before the process exited).
    const isHandover = e !== undefined && e.handoverPhase !== null;
    const wasHandoverDone = e?.handoverPhase === "done";
    if (e) {
      if (e.idleTimer !== null) {
        clearTimeout(e.idleTimer);
      }
      e.currentStatus = "exited";
      if (e.activeWs?.readyState === WebSocket.OPEN) {
        e.activeWs.send(JSON.stringify({ type: "exit", code: exitCode }));
        e.activeWs.close();
      }
    }
    sessions.delete(sessionId);

    // Fallback: if the process exits before the state machine could
    // advance to Review (e.g. Claude crashed), do it now.
    if (isHandover && !wasHandoverDone) {
      advanceToReview(sessionId);
    }
  });
}

/**
 * Attach the standard onData / onExit handlers to a terminal-session PTY
 * process (non-handover: fresh or --continue sessions).
 */
function attachTerminalHandlers(
  ptyProcess: pty.IPty,
  sessionId: string,
): void {
  ptyProcess.onData((data) => {
    const chunk = Buffer.from(data);
    const e = sessions.get(sessionId)!;
    appendToBuffer(e, chunk);
    if (e.activeWs?.readyState === WebSocket.OPEN) {
      e.activeWs.send(chunk);
    }

    const parsed = parseClaudeStatus(data);
    if (parsed !== null) {
      e.lastMeaningfulStatus = parsed;
      if (parsed !== e.currentStatus) {
        e.currentStatus = parsed;
        emitStatus(e.activeWs, parsed);
      }
    }

    // Track meaningful activity: thinking spinner or ⎿ prefix (tool
    // results, "Interrupted" message). Recalled sessions also need this
    // so the ❯ fast-path below can fire for In-Progress tasks.
    if (
      !e.hadMeaningfulActivity &&
      (parsed === "thinking" || data.includes("⎿"))
    ) {
      e.hadMeaningfulActivity = true;
    }

    // Fast path for recalled sessions: ❯ prompt + meaningful activity
    // means the task needs user attention — advance to Review if it is
    // still "In Progress". advanceToReview checks status before moving.
    if (parsed === "waiting" && e.hadMeaningfulActivity) {
      void advanceToReview(sessionId);
    }

    scheduleIdleStatus(e, sessionId);
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
    }
    sessions.delete(sessionId);
  });
}

// ─── HTTP request handler ─────────────────────────────────────────────────────

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsedUrl = parse(req.url ?? "", true);
  const pathname = parsedUrl.pathname ?? "";

  try {
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
        // Pass the spec directly as a CLI argument so Claude starts
        // processing immediately — no need to wait for the REPL idle
        // state and inject via PTY write.
        ptyProcess = pty.spawn(
          command,
          ["--dangerously-skip-permissions", spec],
          {
            name: "xterm-color",
            cols: 80,
            rows: 24,
            cwd,
            env: process.env as Record<string, string>,
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
        handoverPhase: "spec_sent",
        handoverSpec: spec,
        specSentAt: Date.now(),
        hadMeaningfulActivity: false,
        lastMeaningfulStatus: null,
      };
      sessions.set(sessionId, entry);
      sessionRegistry.set(sessionId, {
        id: sessionId,
        cwd,
        createdAt: new Date().toISOString(),
      });
      void saveSessionRegistry();

      attachHandoverHandlers(ptyProcess, sessionId);

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId }));
      return;
    }

    // DELETE /sessions/:id — Kill and remove a session from registry
    if (req.method === "DELETE" && pathname.startsWith("/sessions/")) {
      const id = pathname.slice("/sessions/".length);
      killSession(id);
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /sessions/:id/kill — Kill without full delete (becomingDone / recall)
    // Semantically identical to DELETE for now: kills pty, removes from both
    // maps and persists the registry.  Kept as a separate route so server.ts
    // can distinguish intent in future without changing this process.
    if (
      req.method === "POST" &&
      pathname.startsWith("/sessions/") &&
      pathname.endsWith("/kill")
    ) {
      const id = pathname.slice("/sessions/".length, -"/kill".length);
      killSession(id);
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

// ─── WebSocket connection handler ────────────────────────────────────────────

function handleWsConnection(ws: WebSocket, req: IncomingMessage): void {
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

  wss.on("connection", handleWsConnection);

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
    console.log(`pty-manager ready on http://localhost:${PTY_MANAGER_PORT}`);
  });
}

main().catch((err: unknown) => {
  console.error("pty-manager failed to start:", err);
  process.exit(1);
});
