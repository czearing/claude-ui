# Claude Code Web Terminal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run the actual `claude` CLI in a browser-based terminal on localhost using a custom Next.js server, node-pty, WebSocket, and xterm.js.

**Architecture:** A root-level `server.ts` wraps Next.js's HTTP handler and attaches a `ws` WebSocket server on the same port at `/ws/terminal`. On connect, the server spawns `claude` via `node-pty` in a real PTY; PTY stdout is forwarded as binary WS frames to the browser, and browser keypresses are forwarded as text WS frames back to PTY stdin. The React side is a `Terminal` component (pure xterm.js mount) composed inside a `TerminalPage` client component that owns the socket via a `useTerminalSocket` hook.

**Tech Stack:** Next.js 16, node-pty, ws, @xterm/xterm, @xterm/addon-fit, tsx (for running server.ts)

---

### Task 1: Install runtime and dev dependencies

**Files:**

- Modify: `package.json`

**Step 1: Install runtime deps**

```bash
yarn add node-pty ws @xterm/xterm @xterm/addon-fit
```

**Step 2: Install dev deps**

```bash
yarn add --dev tsx @types/ws
```

**Step 3: Verify installs**

```bash
yarn list node-pty ws @xterm/xterm @xterm/addon-fit tsx
```

Expected: all packages listed with versions.

**Step 4: Commit**

```bash
git add package.json yarn.lock
git commit -m "install node-pty, ws, xterm, and tsx dependencies"
```

---

### Task 2: Update package.json scripts to use custom server

The default `next dev` / `next start` commands bypass our custom server. We replace them with `tsx` running `server.ts` directly.

**Files:**

- Modify: `package.json` (scripts section only)

**Step 1: Update scripts**

In `package.json`, replace the `dev` and `start` scripts:

```json
"dev": "tsx watch server.ts",
"start": "tsx server.ts",
```

Keep all other scripts unchanged.

**Step 2: Verify scripts changed**

```bash
cat package.json | grep -A2 '"dev"'
```

Expected: shows `tsx watch server.ts`.

**Step 3: Commit**

```bash
git add package.json
git commit -m "update dev and start scripts to use custom server via tsx"
```

---

### Task 3: Create root-level custom server

This is the core of the backend. It creates one HTTP server, hands HTTP requests to Next.js, and attaches a WebSocket server for the terminal path.

**Files:**

- Create: `server.ts`

**Step 1: Write `server.ts`**

```typescript
import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import * as pty from "node-pty";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

const command = process.platform === "win32" ? "claude.cmd" : "claude";

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
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
      if (ws.readyState === ws.OPEN) {
        ws.send(Buffer.from(data));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "exit", code: exitCode }));
        ws.close();
      }
    });

    ws.on("message", (data, isBinary) => {
      if (!ptyProcess) return;
      if (isBinary) {
        ptyProcess.write(Buffer.from(data as Buffer).toString());
      } else {
        const text = data.toString();
        try {
          const msg = JSON.parse(text) as {
            type: string;
            cols?: number;
            rows?: number;
          };
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
    console.log(`> Ready on http://localhost:${port}`);
  });
});
```

**Step 2: Verify the server starts**

```bash
yarn dev
```

Expected: `> Ready on http://localhost:3000` with no TypeScript errors. Ctrl+C to stop.

**Step 3: Commit**

```bash
git add server.ts
git commit -m "add custom Next.js server with node-pty WebSocket terminal"
```

---

### Task 4: Create Terminal component types and CSS

**Files:**

- Create: `src/components/Terminal/Terminal.types.ts`
- Create: `src/components/Terminal/Terminal.module.css`

**Step 1: Write `Terminal.types.ts`**

```typescript
import type { Terminal as XTerm } from "@xterm/xterm";

export type TerminalProps = {
  onReady: (term: XTerm | null) => void;
};
```

**Step 2: Write `Terminal.module.css`**

```css
.container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.container :global(.xterm) {
  height: 100%;
  padding: 8px;
  box-sizing: border-box;
}

.container :global(.xterm-viewport) {
  overflow-y: auto;
}
```

---

### Task 5: Write Terminal component test first (TDD)

xterm.js requires a real DOM with canvas support, which jsdom doesn't provide. We mock both packages.

**Files:**

- Create: `src/components/Terminal/Terminal.test.tsx`

**Step 1: Write the failing test**

```typescript
import { render, screen } from "@testing-library/react";

import { Terminal } from "./Terminal";

const mockFit = jest.fn();
const mockOpen = jest.fn();
const mockLoadAddon = jest.fn();
const mockDispose = jest.fn();
const mockOnData = jest.fn().mockReturnValue({ dispose: jest.fn() });
const mockOnResize = jest.fn().mockReturnValue({ dispose: jest.fn() });
const mockXterm = {
  open: mockOpen,
  loadAddon: mockLoadAddon,
  dispose: mockDispose,
  onData: mockOnData,
  onResize: mockOnResize,
  cols: 80,
  rows: 24,
};

jest.mock("@xterm/xterm", () => ({
  Terminal: jest.fn().mockImplementation(() => mockXterm),
}));

jest.mock("@xterm/addon-fit", () => ({
  FitAddon: jest.fn().mockImplementation(() => ({ fit: mockFit })),
}));

describe("Terminal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a container element", () => {
    const onReady = jest.fn();
    render(<Terminal onReady={onReady} />);

    expect(screen.getByTestId("terminal-container")).toBeInTheDocument();
  });

  it("calls onReady with the xterm instance after mount", () => {
    const onReady = jest.fn();
    render(<Terminal onReady={onReady} />);

    expect(onReady).toHaveBeenCalledWith(mockXterm);
  });

  it("opens xterm in the container element", () => {
    render(<Terminal onReady={jest.fn()} />);

    expect(mockOpen).toHaveBeenCalledWith(expect.any(HTMLElement));
  });

  it("calls fit after opening", () => {
    render(<Terminal onReady={jest.fn()} />);

    expect(mockFit).toHaveBeenCalled();
  });

  it("calls onReady with null and disposes xterm on unmount", () => {
    const onReady = jest.fn();
    const { unmount } = render(<Terminal onReady={onReady} />);

    unmount();

    expect(onReady).toHaveBeenLastCalledWith(null);
    expect(mockDispose).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
yarn test src/components/Terminal/Terminal.test.tsx
```

Expected: FAIL — `Terminal` module not found.

---

### Task 6: Implement Terminal component

**Files:**

- Create: `src/components/Terminal/Terminal.tsx`
- Create: `src/components/Terminal/index.ts`

**Step 1: Write `Terminal.tsx`**

```typescript
"use client";

import { useEffect, useRef } from "react";

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import styles from "./Terminal.module.css";
import type { TerminalProps } from "./Terminal.types";

export const Terminal = ({ onReady }: TerminalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "monospace",
      theme: { background: "#0d1117" },
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);
    fitAddon.fit();
    onReady(xterm);

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      onReady(null);
      xterm.dispose();
    };
  }, []); // onReady is a setState setter — stable reference

  return <div ref={containerRef} data-testid="terminal-container" className={styles.container} />;
};
```

**Step 2: Write `index.ts`**

```typescript
export * from "./Terminal";
export * from "./Terminal.types";
```

**Step 3: Run tests to verify they pass**

```bash
yarn test src/components/Terminal/Terminal.test.tsx
```

Expected: PASS — all 5 tests green.

**Step 4: Commit**

```bash
git add src/components/Terminal/
git commit -m "add Terminal component wrapping xterm.js with fit addon"
```

---

### Task 7: Create useTerminalSocket hook

**Files:**

- Create: `src/hooks/useTerminalSocket.ts`
- Create: `src/hooks/useTerminalSocket.types.ts`

**Step 1: Write `useTerminalSocket.types.ts`**

```typescript
import type { Terminal as XTerm } from "@xterm/xterm";

export type UseTerminalSocketOptions = {
  xterm: XTerm | null;
};
```

**Step 2: Write `useTerminalSocket.ts`**

```typescript
"use client";

import { useEffect } from "react";

import type { Terminal as XTerm } from "@xterm/xterm";

export const useTerminalSocket = (xterm: XTerm | null) => {
  useEffect(() => {
    if (!xterm) return;

    const ws = new WebSocket(`ws://${window.location.host}/ws/terminal`);

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
        };
        if (msg.type === "exit") {
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

    ws.binaryType = "arraybuffer";

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
      ws.close();
    };
  }, [xterm]);
};
```

Note: `ws.binaryType = "arraybuffer"` must be set before messages arrive. Move it before `ws.onopen` if order is a concern — set it right after construction:

The line `ws.binaryType = "arraybuffer"` should actually be placed immediately after `new WebSocket(...)`:

```typescript
const ws = new WebSocket(`ws://${window.location.host}/ws/terminal`);
ws.binaryType = "arraybuffer";
```

Update the file to put `ws.binaryType = "arraybuffer"` on line 2 after the `new WebSocket(...)` call.

**Step 3: Commit**

```bash
git add src/hooks/useTerminalSocket.ts src/hooks/useTerminalSocket.types.ts
git commit -m "add useTerminalSocket hook for WebSocket-PTY communication"
```

---

### Task 8: Create TerminalPage client component

**Files:**

- Create: `src/app/TerminalPage.tsx`
- Create: `src/app/TerminalPage.module.css`
- Create: `src/app/TerminalPage.types.ts`

**Step 1: Write `TerminalPage.types.ts`**

```typescript
import type { Terminal as XTerm } from "@xterm/xterm";

export type TerminalPageState = {
  xterm: XTerm | null;
};
```

**Step 2: Write `TerminalPage.module.css`**

```css
.page {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #0d1117;
}
```

**Step 3: Write `TerminalPage.tsx`**

```typescript
"use client";

import { useState } from "react";

import type { Terminal as XTerm } from "@xterm/xterm";

import { Terminal } from "@/components";
import { useTerminalSocket } from "@/hooks/useTerminalSocket";

import styles from "./TerminalPage.module.css";

export const TerminalPage = () => {
  const [xterm, setXterm] = useState<XTerm | null>(null);

  useTerminalSocket(xterm);

  return (
    <div className={styles.page}>
      <Terminal onReady={setXterm} />
    </div>
  );
};
```

**Step 4: Commit**

```bash
git add src/app/TerminalPage.tsx src/app/TerminalPage.module.css src/app/TerminalPage.types.ts
git commit -m "add TerminalPage client component composing Terminal and useTerminalSocket"
```

---

### Task 9: Wire up page.tsx and update barrel exports

**Files:**

- Modify: `src/app/page.tsx`
- Modify: `src/components/index.ts`

**Step 1: Update `src/app/page.tsx`**

```typescript
import { TerminalPage } from "./TerminalPage";

export default function HomePage() {
  return <TerminalPage />;
}
```

**Step 2: Update `src/components/index.ts`**

```typescript
export * from "./Terminal";
```

**Step 3: Commit**

```bash
git add src/app/page.tsx src/components/index.ts
git commit -m "wire TerminalPage into app root and export Terminal from components barrel"
```

---

### Task 10: Lint, build check, and smoke test

**Step 1: Run lint**

```bash
yarn lint
```

Expected: 0 errors, 0 warnings.

**Step 2: Run tests**

```bash
yarn test
```

Expected: all tests pass.

**Step 3: Run dev server and verify terminal loads**

```bash
yarn dev
```

Open `http://localhost:3000` in the browser. Expected:

- Black terminal fills the viewport
- `claude` launches and its welcome/interactive prompt appears
- Typing works (keypresses echoed back through PTY)
- Resizing the browser window resizes the terminal

**Step 4: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "fix lint issues from terminal implementation"
```

---

## Protocol Reference

| Direction       | Frame type                                | Meaning                                             |
| --------------- | ----------------------------------------- | --------------------------------------------------- |
| Server → Client | Binary                                    | PTY stdout bytes — pass directly to `xterm.write()` |
| Server → Client | Text JSON `{type:"exit",code:N}`          | PTY process exited                                  |
| Server → Client | Text JSON `{type:"error",message:S}`      | Spawn failure                                       |
| Client → Server | Text (raw)                                | Keypress / stdin bytes                              |
| Client → Server | Text JSON `{type:"resize",cols:N,rows:N}` | Terminal resize                                     |

## Notes

- `node-pty` requires native compilation. If it fails to install, run `npm rebuild node-pty` inside the project directory.
- On Windows, `claude.cmd` is used instead of `claude` since npm-installed CLIs have `.cmd` wrappers.
- `ws.binaryType = "arraybuffer"` must be set immediately after `new WebSocket()` so binary frames arrive as `ArrayBuffer` rather than `Blob`.
- The `useTerminalSocket` effect depends on `xterm` state, so it only opens the WebSocket after `Terminal` mounts and calls `onReady(xterm)`.
