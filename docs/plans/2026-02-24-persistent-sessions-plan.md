# Persistent Claude Sessions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep claude pty processes alive on the server across WebSocket disconnects so navigating away and back re-attaches to the same running instance.

**Architecture:** Server maintains a `Map<sessionId, SessionEntry>` keyed by the session ID. On WS connect the client sends its ID in the URL query string; the server attaches to the existing pty (replaying buffered output) or spawns a new one. On WS disconnect the pty is kept alive. Session cleanup happens via `DELETE /api/sessions/:id`.

**Tech Stack:** node-pty, ws (WebSocket), Next.js App Router (React 19), TypeScript strict, Jest + @testing-library/react

---

## Task 1: Server — session registry + persistent pty

**Files:**

- Modify: `server.ts`

This task replaces the single-pty-per-connection model with a session-keyed registry. Tasks 1 and 2 are independent and can be done in parallel.

**Step 1: Write a failing integration-style check (manual)**

Start the server (`yarn dev`), open a session, type something, navigate away, navigate back. Confirm a new blank terminal appears (the bug). This is the baseline.

**Step 2: Replace `server.ts` with the following complete implementation**

```ts
import next from "next";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

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

app
  .prepare()
  .then(() => {
    const server = createServer((req, res) => {
      const parsedUrl = parse(req.url!, true);

      // Handle DELETE /api/sessions/:id — kill the pty and remove from registry
      if (
        req.method === "DELETE" &&
        parsedUrl.pathname?.startsWith("/api/sessions/")
      ) {
        const id = parsedUrl.pathname.slice("/api/sessions/".length);
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

      void handle(req, res, parsedUrl);
    });

    const wss = new WebSocketServer({ server, path: "/ws/terminal" });

    wss.on("connection", (ws, req) => {
      const url = parse(req.url ?? "", true);
      const sessionId = url.query["sessionId"] as string | undefined;

      if (!sessionId) {
        ws.send(
          JSON.stringify({ type: "error", message: "Missing sessionId" }),
        );
        ws.close();
        return;
      }

      let entry = sessions.get(sessionId);

      if (entry) {
        // Reconnect: attach this WS, replay buffer
        entry.activeWs = ws;
        if (entry.outputBuffer.length > 0) {
          const replay = Buffer.concat(entry.outputBuffer);
          ws.send(
            JSON.stringify({ type: "replay", data: replay.toString("base64") }),
          );
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

        entry = {
          pty: ptyProcess,
          outputBuffer: [],
          bufferSize: 0,
          activeWs: ws,
        };
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
        if (!e) return;
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
    });

    server.listen(port, () => {
      console.error(`> Ready on http://localhost:${port}`);
    });
  })
  .catch((err: unknown) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
```

**Step 3: Verify TypeScript compiles**

```bash
yarn tsc --noEmit
```

Expected: no errors

**Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: persist pty sessions across WebSocket reconnects"
```

---

## Task 2: Client — thread sessionId through + replay handler + deleteSession API call

**Files:**

- Modify: `src/hooks/useTerminalSocket.types.ts`
- Modify: `src/hooks/useTerminalSocket.ts`
- Modify: `src/app/TerminalPage.types.ts`
- Modify: `src/app/TerminalPage.tsx`
- Modify: `src/app/session/[id]/SessionPage.tsx`
- Modify: `src/hooks/useSessionStore.ts`

This task is independent from Task 1 and can be done in parallel.

**Step 1: Update `src/hooks/useTerminalSocket.types.ts`**

```ts
import type { Terminal as XTerm } from "@xterm/xterm";

export type UseTerminalSocketOptions = {
  xterm: XTerm | null;
  sessionId: string;
};
```

**Step 2: Update `src/hooks/useTerminalSocket.ts`**

Replace the entire file:

```ts
"use client";

import { useEffect } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";

export const useTerminalSocket = (xterm: XTerm | null, sessionId: string) => {
  useEffect(() => {
    if (!xterm) {
      return;
    }

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
        };
        if (msg.type === "replay" && msg.data) {
          xterm.clear();
          xterm.write(Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0)));
        } else if (msg.type === "exit") {
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
  }, [xterm, sessionId]);
};
```

**Step 3: Update `src/app/TerminalPage.tsx`** — accept `sessionId` prop

```tsx
"use client";

import { useState } from "react";

import { Terminal } from "@/components";
import { useTerminalSocket } from "@/hooks/useTerminalSocket";
import styles from "./TerminalPage.module.css";
import type { TerminalPageState } from "./TerminalPage.types";

type TerminalPageProps = {
  sessionId: string;
};

export const TerminalPage = ({ sessionId }: TerminalPageProps) => {
  const [xterm, setXterm] = useState<TerminalPageState["xterm"]>(null);

  useTerminalSocket(xterm, sessionId);

  return (
    <div className={styles.page}>
      <Terminal onReady={setXterm} />
    </div>
  );
};
```

**Step 4: Update `src/app/session/[id]/SessionPage.tsx`** — pass id as sessionId

```tsx
"use client";

import { use } from "react";
import Link from "next/link";

import { useSessionStore } from "@/hooks/useSessionStore";
import { TerminalPage } from "@/app/TerminalPage";

import styles from "./SessionPage.module.css";

type SessionPageProps = {
  params: Promise<{ id: string }>;
};

export const SessionPage = ({ params }: SessionPageProps) => {
  const { id } = use(params);
  const { sessions } = useSessionStore();
  const session = sessions.find((s) => s.id === id);
  const sessionName = session?.name ?? "Instance";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link
          href="/"
          className={styles.backLink}
          aria-label="Back to instances"
        >
          ← Back
        </Link>
        <span className={styles.sessionName}>{sessionName}</span>
      </header>
      <div className={styles.terminal}>
        <TerminalPage sessionId={id} />
      </div>
    </div>
  );
};
```

**Step 5: Update `src/hooks/useSessionStore.ts`** — add `deleteSession` that calls the server

```ts
"use client";

import { useEffect, useState } from "react";

export type Session = {
  id: string;
  name: string;
  createdAt: string;
};

const STORAGE_KEY = "claude-sessions";

function loadSessions(): Session[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function nextInstanceName(sessions: Session[]): string {
  const count = sessions.length + 1;
  return `Instance ${count}`;
}

export function useSessionStore() {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    setSessions(loadSessions());
  }, []);

  function addSession(): Session {
    const current = loadSessions();
    const session: Session = {
      id: crypto.randomUUID(),
      name: nextInstanceName(current),
      createdAt: new Date().toISOString(),
    };
    const updated = [...current, session];
    saveSessions(updated);
    setSessions(updated);
    return session;
  }

  async function deleteSession(id: string): Promise<void> {
    try {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    } catch {
      // best effort — remove from local store regardless
    }
    const current = loadSessions();
    const updated = current.filter((s) => s.id !== id);
    saveSessions(updated);
    setSessions(updated);
  }

  return { sessions, addSession, deleteSession };
}
```

**Step 6: Update `src/app/HomePage.tsx`** — wire `handleDelete` to `deleteSession`

In `HomePage.tsx`, change `removeSession` to `deleteSession`:

```tsx
"use client";

import { useRouter } from "next/navigation";

import { InstanceCard } from "@/components";
import { useSessionStore } from "@/hooks/useSessionStore";

import styles from "./HomePage.module.css";
import type { Session } from "@/hooks/useSessionStore";

export const HomePage = () => {
  const router = useRouter();
  const { sessions, addSession, deleteSession } = useSessionStore();

  function handleNewInstance() {
    const session = addSession();
    router.push(`/session/${session.id}`);
  }

  function handleOpen(session: Session) {
    router.push(`/session/${session.id}`);
  }

  function handleDelete(id: string) {
    void deleteSession(id);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Claude Instances</h1>
        <button
          type="button"
          className={styles.newButton}
          onClick={handleNewInstance}
        >
          New Instance
        </button>
      </header>
      <main className={styles.main}>
        {sessions.length === 0 ? (
          <p className={styles.emptyState}>
            No instances yet. Click &ldquo;New Instance&rdquo; to start.
          </p>
        ) : (
          <ul className={styles.grid} aria-label="Claude instances">
            {sessions.map((session) => (
              <li key={session.id} className={styles.gridItem}>
                <InstanceCard
                  session={session}
                  onOpen={handleOpen}
                  onDelete={handleDelete}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};
```

**Step 7: Verify TypeScript compiles**

```bash
yarn tsc --noEmit
```

Expected: no errors

**Step 8: Commit**

```bash
git add src/hooks/useTerminalSocket.types.ts src/hooks/useTerminalSocket.ts \
        src/app/TerminalPage.tsx src/app/session/[id]/SessionPage.tsx \
        src/hooks/useSessionStore.ts src/app/HomePage.tsx
git commit -m "feat: thread sessionId through client stack and handle replay"
```

---

## Task 3: Tests — useSessionStore.deleteSession + useTerminalSocket

**Files:**

- Create: `src/hooks/useSessionStore.test.ts`
- Create: `src/hooks/useTerminalSocket.test.ts`

This task depends on Tasks 1 and 2 being complete.

### useSessionStore tests

**Step 1: Create `src/hooks/useSessionStore.test.ts`**

```ts
import { renderHook, act, waitFor } from "@testing-library/react";

import { useSessionStore } from "./useSessionStore";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

global.fetch = jest.fn().mockResolvedValue({ ok: true });

describe("useSessionStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it("deleteSession calls DELETE /api/sessions/:id", async () => {
    const { result } = renderHook(() => useSessionStore());

    let session: ReturnType<typeof result.current.addSession>;
    act(() => {
      session = result.current.addSession();
    });

    await act(async () => {
      await result.current.deleteSession(session!.id);
    });

    expect(global.fetch).toHaveBeenCalledWith(`/api/sessions/${session!.id}`, {
      method: "DELETE",
    });
  });

  it("deleteSession removes session from state", async () => {
    const { result } = renderHook(() => useSessionStore());

    let session: ReturnType<typeof result.current.addSession>;
    act(() => {
      session = result.current.addSession();
    });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteSession(session!.id);
    });

    expect(result.current.sessions).toHaveLength(0);
  });

  it("deleteSession removes session even if fetch throws", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network error"),
    );
    const { result } = renderHook(() => useSessionStore());

    let session: ReturnType<typeof result.current.addSession>;
    act(() => {
      session = result.current.addSession();
    });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteSession(session!.id);
    });

    expect(result.current.sessions).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it passes**

```bash
yarn test src/hooks/useSessionStore.test.ts
```

Expected: 3 passing tests

### useTerminalSocket tests

**Step 3: Create `src/hooks/useTerminalSocket.test.ts`**

```ts
import { renderHook } from "@testing-library/react";

import { useTerminalSocket } from "./useTerminalSocket";

// Minimal xterm mock
const mockWrite = jest.fn();
const mockClear = jest.fn();
const mockOnData = jest.fn().mockReturnValue({ dispose: jest.fn() });
const mockOnResize = jest.fn().mockReturnValue({ dispose: jest.fn() });
const mockXterm = {
  write: mockWrite,
  clear: mockClear,
  onData: mockOnData,
  onResize: mockOnResize,
  cols: 80,
  rows: 24,
};

// WebSocket mock
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn();
  url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.lastInstance = this;
  }
  static lastInstance: MockWebSocket;
}

Object.defineProperty(window, "WebSocket", {
  value: MockWebSocket,
  writable: true,
});
Object.defineProperty(window, "location", {
  value: { host: "localhost:3000" },
  writable: true,
});

describe("useTerminalSocket", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("connects to the terminal WS endpoint with sessionId in the URL", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    expect(MockWebSocket.lastInstance.url).toBe(
      "ws://localhost:3000/ws/terminal?sessionId=session-abc",
    );
  });

  it("sends a resize message on open", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    MockWebSocket.lastInstance.onopen?.();

    expect(MockWebSocket.lastInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "resize", cols: 80, rows: 24 }),
    );
  });

  it("writes binary ArrayBuffer data directly to xterm", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer;
    MockWebSocket.lastInstance.onmessage?.({ data: buffer } as MessageEvent);

    expect(mockWrite).toHaveBeenCalledWith(new Uint8Array(buffer));
  });

  it("clears terminal and writes replay data on replay message", () => {
    renderHook(() => useTerminalSocket(mockXterm as never, "session-abc"));

    // "Hello" base64-encoded
    const encoded = btoa("Hello");
    MockWebSocket.lastInstance.onmessage?.({
      data: JSON.stringify({ type: "replay", data: encoded }),
    } as MessageEvent);

    expect(mockClear).toHaveBeenCalled();
    expect(mockWrite).toHaveBeenCalledWith(
      Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
    );
  });

  it("does not open WebSocket when xterm is null", () => {
    const countBefore = MockWebSocket.lastInstance ? 1 : 0;
    renderHook(() => useTerminalSocket(null, "session-abc"));

    // No new instance created
    expect(MockWebSocket.lastInstance?.url).not.toBe(
      "ws://localhost:3000/ws/terminal?sessionId=session-abc",
    );
  });
});
```

**Step 4: Run tests**

```bash
yarn test src/hooks/useTerminalSocket.test.ts
```

Expected: 5 passing tests

**Step 5: Run full test suite**

```bash
yarn test
```

Expected: all tests passing, no regressions

**Step 6: Commit**

```bash
git add src/hooks/useSessionStore.test.ts src/hooks/useTerminalSocket.test.ts
git commit -m "test: add useSessionStore.deleteSession and useTerminalSocket tests"
```

---

## Task 4: Manual E2E verification

**Step 1: Start the server**

```bash
yarn dev
```

**Step 2: Open `http://localhost:3000`**

Click "New Instance". You should be navigated to `/session/<id>` and a claude terminal should start.

**Step 3: Type something and let claude start responding**

e.g., type `hello` and press Enter.

**Step 4: While claude is responding, click "← Back"**

You should be on the home page. The pty is still running on the server.

**Step 5: Click the session card to re-open it**

You should see the terminal re-appear with all previous output (replay), and if claude was mid-response, it should continue.

**Step 6: Delete the session from the home page**

Click the × button. Confirm the card disappears. The server-side pty process should be killed.

---

## Agent Team

| Agent                 | Tasks       | Can start immediately?        |
| --------------------- | ----------- | ----------------------------- |
| Agent 1 (Backend)     | Task 1      | Yes                           |
| Agent 2 (Client)      | Task 2      | Yes (parallel with Agent 1)   |
| Agent 3 (Tests + E2E) | Tasks 3 + 4 | After Agents 1 and 2 complete |
