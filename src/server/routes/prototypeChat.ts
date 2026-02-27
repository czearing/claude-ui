import * as pty from "node-pty";

import { encodeCwdToProjectDir } from "../../utils/captureClaudeSessionId";
import { readBody } from "../../utils/readBody";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { parse } from "node:url";

// Strip ANSI/VT escape sequences including OSC sequences so raw PTY output
// becomes clean text. Covers CSI, OSC (BEL or ST terminated), and 2-char ESC sequences.
/* eslint-disable no-control-regex */
const ANSI_RE =
  /\x1b\[[\x20-\x3f]*[\x40-\x7e]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]]/g;
/* eslint-enable no-control-regex */

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

type HistoryMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
};

async function handleHistoryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: ReturnType<typeof parse>,
): Promise<boolean> {
  if (req.method !== "GET" || parsedUrl.pathname !== "/api/prototype/history") {
    return false;
  }

  const params = new URLSearchParams(parsedUrl.query ?? "");
  const sessionId = params.get("sessionId") ?? "";
  const cwd = params.get("cwd") ?? process.cwd();

  if (!sessionId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "sessionId required" }));
    return true;
  }

  const encoded = encodeCwdToProjectDir(cwd);
  const filePath = join(
    homedir(),
    ".claude",
    "projects",
    encoded,
    `${sessionId}.jsonl`,
  );

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Session not found" }));
    return true;
  }

  const messages: HistoryMessage[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (obj.type === "user") {
      const msg = obj.message as { content: unknown } | undefined;
      const content = msg?.content;
      if (typeof content === "string" && content) {
        messages.push({ role: "user", content });
      }
    } else if (obj.type === "assistant") {
      const msg = obj.message as { content: unknown } | undefined;
      const content = msg?.content;
      if (Array.isArray(content)) {
        for (const item of content as Array<Record<string, unknown>>) {
          if (
            item.type === "text" &&
            typeof item.text === "string" &&
            item.text
          ) {
            messages.push({ role: "assistant", content: item.text });
          } else if (item.type === "tool_use") {
            messages.push({
              role: "tool",
              content: JSON.stringify(item.input, null, 2),
              toolName: typeof item.name === "string" ? item.name : undefined,
            });
          }
        }
      }
    }
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(messages));
  return true;
}

export async function handlePrototypeChatRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  parsedUrl: ReturnType<typeof parse>,
): Promise<boolean> {
  if (await handleHistoryRoute(req, res, parsedUrl)) {
    return true;
  }

  if (req.method !== "POST" || parsedUrl.pathname !== "/api/prototype/chat") {
    return false;
  }

  const body = await readBody(req);
  const message = typeof body["message"] === "string" ? body["message"] : "";
  const cwd = typeof body["cwd"] === "string" ? body["cwd"] : process.cwd();
  const sessionId =
    typeof body["sessionId"] === "string" ? body["sessionId"] : undefined;

  const claudeCmd =
    process.env["CLAUDE_PATH"] ??
    (process.platform === "win32" ? "claude.cmd" : "claude");

  const args: string[] = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  args.push("-p", message);

  // Build env without Claude-specific vars that block nested invocations.
  const BLOCKED_ENV = new Set([
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_UI_SESSION_ID",
  ]);
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!BLOCKED_ENV.has(k) && v !== undefined) {
      childEnv[k] = v;
    }
  }

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(claudeCmd, args, {
      name: "xterm-color",
      cols: 220,
      rows: 24,
      cwd,
      env: childEnv,
      useConptyDll: process.platform === "win32",
    });
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/x-ndjson" });
    res.write(`${JSON.stringify({ type: "error", error: String(err) })}\n`);
    res.end();
    return true;
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache",
    "Transfer-Encoding": "chunked",
  });

  let lineBuf = "";

  ptyProcess.onData((data) => {
    // Normalize line endings and strip terminal escape codes.
    const cleaned = stripAnsi(data).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    lineBuf += cleaned;
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      // Only forward lines that look like JSON objects.
      if (!t.startsWith("{")) {
        continue;
      }
      try {
        JSON.parse(t);
        res.write(`${t}\n`);
      } catch {
        // skip malformed output
      }
    }
  });

  ptyProcess.onExit(() => {
    // Flush any partial line still in the buffer.
    const t = lineBuf.trim();
    if (t.startsWith("{")) {
      try {
        JSON.parse(t);
        res.write(`${t}\n`);
      } catch {
        // skip
      }
    }
    res.write('{"type":"done"}\n');
    res.end();
  });

  req.on("close", () => {
    try {
      ptyProcess.kill();
    } catch {
      // already exited
    }
  });

  return true;
}
