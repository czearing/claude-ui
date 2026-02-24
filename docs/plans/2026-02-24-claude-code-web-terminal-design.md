# Claude Code Web Terminal — Design

**Date:** 2026-02-24
**Status:** Approved

## Overview

Run the actual Claude Code CLI as a web terminal session accessible on localhost. The browser renders a full terminal emulator; the server spawns `claude` in a real PTY and pipes bytes over WebSocket. No auth (localhost only), single session, bare terminal UI.

## Architecture

```
Browser (xterm.js)
    ↕ WebSocket (binary frames)
Custom Next.js server (server.ts)
    ├── Next.js HTTP handler  →  React app
    └── ws WebSocket server  →  node-pty  →  claude CLI process
```

A root-level `server.ts` creates an `http.Server`, delegates HTTP to Next.js, and attaches a `ws.Server` on the same port at path `/ws/terminal`. When a client connects, the server spawns `claude` via `node-pty`. PTY output is forwarded as binary WebSocket frames; client frames are written as PTY stdin. Resize is a JSON frame `{type:"resize",cols,rows}`. One PTY per connection, killed on disconnect.

## File Structure

```
server.ts                          — root-level custom Next.js server (ws + node-pty)
src/
  app/
    page.tsx                       — thin server component, renders <TerminalPage />
    TerminalPage.tsx               — "use client", composes Terminal + mounts socket
    TerminalPage.module.css
    TerminalPage.types.ts
  components/
    Terminal/
      index.ts
      Terminal.tsx                 — pure xterm.js mount, accepts ref/props
      Terminal.module.css
      Terminal.types.ts
      Terminal.stories.tsx
      Terminal.test.tsx
  hooks/
    useTerminalSocket.ts           — manages WebSocket, writes to xterm, sends stdin
    useTerminalSocket.types.ts
```

`TerminalPage` owns the socket lifecycle and passes the xterm instance down. `Terminal` is a pure presentational component — mounts xterm.js into a div, exposes a ref. `useTerminalSocket` handles connection state and resize events.

## Data Flow

```
TerminalPage mounts
  → useTerminalSocket opens ws://localhost:PORT/ws/terminal
  → server.ts receives connection, spawns node-pty with `claude` in cwd
  → PTY stdout → ws binary frame → xterm.js .write()
  → xterm.js onData (keypress) → ws binary frame → PTY stdin
  → xterm.js onResize → ws JSON frame {type:"resize",cols,rows} → PTY .resize()
  → WebSocket close → PTY process killed
```

## Error Handling

- PTY process exits → server sends `{type:"exit",code:N}` JSON frame → terminal displays "Session ended. Reload to restart."
- WebSocket disconnect → terminal shows disconnected state, no auto-reconnect
- `node-pty` spawn failure (e.g. `claude` not on PATH) → server closes socket with readable error, terminal displays reason

## Dependencies

- `node-pty` — PTY spawning (requires native compilation)
- `ws` — WebSocket server
- `xterm` — browser terminal emulator
- `xterm-addon-fit` — resize terminal to container
