# Persistent Claude Sessions Design

**Date:** 2026-02-24
**Status:** Approved

## Problem

Every time the user navigates to a session URL, `useTerminalSocket` opens a new WebSocket connection. The server spawns a fresh `claude` pty process for every connection and kills it on disconnect. Session IDs stored in localStorage are purely cosmetic — there is no server-side process backing them. Returning to a session always starts a brand new claude instance.

## Goal

The pty process for each session must survive WebSocket disconnects. Navigating away and back should re-attach to the same running process, replaying any output that occurred while disconnected.

## Approach: In-memory session map with output buffer

Chosen over tmux (requires non-Windows tooling) and detached child processes (complex IPC). This approach requires no new dependencies and solves the problem with minimal changes.

## Architecture

### Server (`server.ts`)

**Session registry:**

```ts
type SessionEntry = {
  pty: IPty;
  outputBuffer: Buffer[];
  activeWs: WebSocket | null;
};
const sessions = new Map<string, SessionEntry>();
```

**On WebSocket connect:**
- Parse `sessionId` from the WS URL query string (`/ws/terminal?sessionId=<id>`)
- If `sessions.has(sessionId)`: attach the new WS to the existing entry, send buffered output as a replay message, then stream live output
- If not: spawn a new pty, create an entry in the map, stream live output

**While pty produces output:**
- Always append to `entry.outputBuffer` (rolling cap: ~500KB of raw bytes — drop oldest chunks when exceeded)
- If `entry.activeWs` is connected and open, also send the chunk live

**On WebSocket disconnect:**
- Set `entry.activeWs = null`
- Do NOT kill the pty

**Session cleanup:**
- Add `DELETE /api/sessions/:id` HTTP endpoint
- On request: kill the pty, remove from map, respond 204

### Client

**`useTerminalSocket(xterm, sessionId)`**
- Accepts a `sessionId: string` parameter
- Connects to `ws://${window.location.host}/ws/terminal?sessionId=${sessionId}`
- On receiving `{ type: "replay", data: string }`: write `Buffer.from(data, "base64")` to the terminal
- Existing binary streaming and resize logic unchanged

**`TerminalPage({ sessionId })`**
- Accepts and forwards `sessionId` to `useTerminalSocket`

**`SessionPage`**
- Already has `id` from URL params — passes it to `TerminalPage`

**`useSessionStore`**
- Adds `deleteSession(id: string)`: calls `DELETE /api/sessions/:id`, then removes from localStorage

## Data Flow

```
[User opens /session/abc]
  → SessionPage extracts id="abc"
  → TerminalPage passes sessionId="abc" to useTerminalSocket
  → WS connects to /ws/terminal?sessionId=abc
  → Server: sessions.has("abc")?
      YES → send replay buffer → stream live output
      NO  → spawn new pty("abc") → stream live output

[User navigates to /]
  → WS closes
  → Server: entry.activeWs = null, pty keeps running

[User reopens /session/abc]
  → Same flow, takes YES branch
```

## Agent Team

| Agent | Scope | Files |
|-------|-------|-------|
| Agent 1 (Backend) | Session registry, buffer, replay, DELETE endpoint | `server.ts` |
| Agent 2 (Client) | sessionId prop chain, WS URL, replay handler, deleteSession API call | `useTerminalSocket.ts`, `TerminalPage.tsx`, `TerminalPage.types.ts`, `SessionPage.tsx`, `useSessionStore.ts` |
| Agent 3 (Tests) | Unit tests for new behavior | `useTerminalSocket` tests, `useSessionStore` tests |

Agents 1 and 2 run in parallel. Agent 3 waits for both.

## Out of Scope

- Surviving server restarts (processes are in-memory only)
- Session naming / renaming
- Max concurrent sessions limit
