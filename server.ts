import next from "next";
import * as pty from "node-pty";
import { WebSocketServer } from "ws";

import { createServer } from "node:http";
import { parse } from "node:url";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

const command = process.platform === "win32" ? "claude.cmd" : "claude";

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    void handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ server, path: "/ws/terminal" });

  wss.on("connection", (ws) => {
    let ptyProcess: pty.IPty | null = null;

    try {
      ptyProcess = pty.spawn(command, [], {
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

    ptyProcess.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from(data));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "exit", code: exitCode }));
        ws.close();
      }
    });

    ws.on("message", (data, isBinary) => {
      if (!ptyProcess) {
        return;
      }
      if (isBinary) {
        ptyProcess.write(Buffer.from(data as ArrayBuffer).toString());
      } else {
        const text = (data as Buffer).toString("utf8");
        try {
          const msg = JSON.parse(text) as { type: string; cols?: number; rows?: number };
          if (msg.type === "resize" && msg.cols && msg.rows) {
            ptyProcess.resize(msg.cols, msg.rows);
            return;
          }
        } catch {
          // not JSON — write raw to PTY
        }
        ptyProcess.write(text);
      }
    });

    ws.on("close", () => {
      ptyProcess?.kill();
      ptyProcess = null;
    });
  });

  server.listen(port, () => {
    console.error(`> Ready on http://localhost:${port}`);
  });
}).catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
