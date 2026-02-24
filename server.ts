import next from "next";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";


import {
  addBoardClient,
  broadcast,
} from "./src/utils/boardBroadcast.server.js";
import { getAllTasks, loadTasks } from "./src/utils/tasks.server.js";
import { handleTasksRoute } from "./src/utils/tasksHandler.server.js";

import { createServer } from "node:http";
import { parse } from "node:url";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

const command = process.platform === "win32" ? "claude.cmd" : "claude";

const BUFFER_CAP = 500 * 1024; // 500 KB rolling buffer per session

type SessionEntry = {
  pty: pty.IPty;
  outputBuffer: Buffer[];
  bufferSize: number;
  activeWs: WebSocket | null;
};

const sessions = new Map<string, SessionEntry>();

function appendToBuffer(entry: SessionEntry, chunk: Buffer): void {
  entry.outputBuffer.push(chunk);
  entry.bufferSize += chunk.byteLength;
  while (entry.bufferSize > BUFFER_CAP && entry.outputBuffer.length > 1) {
    const removed = entry.outputBuffer.shift()!;
    entry.bufferSize -= removed.byteLength;
  }
}

loadTasks();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    const pathname = parsedUrl.pathname ?? "";

    // Handle DELETE /api/sessions/:id — kill the pty and remove from registry
    if (req.method === "DELETE" && pathname.startsWith("/api/sessions/")) {
      const id = pathname.slice("/api/sessions/".length);
      const entry = sessions.get(id);
      if (entry) {
        entry.activeWs = null;
        entry.pty.kill();
        sessions.delete(id);
      }
      res.writeHead(204);
      res.end();
      return;
    }

    // Handle /api/tasks routes
    if (pathname.startsWith("/api/tasks")) {
      void handleTasksRoute(req, res, pathname).then((handled) => {
        if (!handled) {
          void handle(req, res, parsedUrl);
        }
      });
      return;
    }

    void handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ server, path: "/ws/terminal" });
  const boardWss = new WebSocketServer({ server, path: "/ws/board" });

  boardWss.on("connection", (ws) => {
    addBoardClient(ws);
    broadcast({ type: "snapshot", tasks: getAllTasks() });
  });

  wss.on("connection", (ws, req) => {
    const url = parse(req.url ?? "", true);
    const sessionId = url.query["sessionId"] as string | undefined;

    if (!sessionId) {
      ws.send(JSON.stringify({ type: "error", message: "Missing sessionId" }));
      ws.close();
      return;
    }

    let entry = sessions.get(sessionId);

    if (entry) {
      // Reconnect: attach this WS, replay buffer
      entry.activeWs = ws;
      if (entry.outputBuffer.length > 0) {
        const replay = Buffer.concat(entry.outputBuffer);
        ws.send(JSON.stringify({ type: "replay", data: replay.toString("base64") }));
      }
    } else {
      // New session: spawn pty
      let ptyProcess: pty.IPty;
      try {
        ptyProcess = pty.spawn(command, ["--dangerously-skip-permissions"], {
          name: "xterm-color",
          cols: 80,
          rows: 24,
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
        });
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: String(err) }));
        ws.close();
        return;
      }

      entry = { pty: ptyProcess, outputBuffer: [], bufferSize: 0, activeWs: ws };
      sessions.set(sessionId, entry);

      ptyProcess.onData((data) => {
        const chunk = Buffer.from(data);
        const e = sessions.get(sessionId)!;
        appendToBuffer(e, chunk);
        if (e.activeWs?.readyState === WebSocket.OPEN) {
          e.activeWs.send(chunk);
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        const e = sessions.get(sessionId);
        if (e?.activeWs?.readyState === WebSocket.OPEN) {
          e.activeWs.send(JSON.stringify({ type: "exit", code: exitCode }));
          e.activeWs.close();
        }
        sessions.delete(sessionId);
      });
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
          const msg = JSON.parse(text) as { type: string; cols?: number; rows?: number };
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
  });

  server.listen(port, () => {
    console.error(`> Ready on http://localhost:${port}`);
  });
}).catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
