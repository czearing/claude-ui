# Recall Task from Agent — Design

**Date:** 2026-02-24
**Status:** Approved

## Problem

There is no way to move a task out of "In Progress" once it has been handed over to Claude. If a user accidentally triggers a handover, or wants to reclaim a task, they are stuck — the only option is to delete the task entirely.

## Solution

Add a **three-dot overflow menu** (`…`) to every board `TaskCard` that consolidates all destructive actions. For "In Progress" cards the menu exposes a **"Move to Backlog"** action that kills the running agent session and resets the task. For all other board cards the menu contains only **"Delete"**.

## User Flow

1. User hovers over any board card → `…` button appears in the top-right corner
2. User clicks `…` → small dropdown opens with:
   - **"In Progress" cards only:** `↩ Move to Backlog` (with dim subline "stops the running agent"), then a separator, then `🗑 Delete`
   - **All other board cards:** `🗑 Delete`
3. Clicking **Move to Backlog** immediately kills the agent PTY, resets task status to `"Backlog"`, clears `sessionId`, broadcasts the update via WebSocket, and closes the dropdown — no additional confirm needed
4. Clicking **Delete** deletes the task (existing behaviour, `window.confirm` removed)
5. The task disappears from the board column instantly via optimistic update and reappears in the Backlog view

## API Contract

### `POST /api/tasks/:id/recall`

**Server logic (order matters to avoid race with `onExit` auto-advance):**

1. Look up task by `id` — 404 if not found
2. Update task in `tasks.json`: `status → "Backlog"`, `sessionId → undefined`, `updatedAt → now`
3. Broadcast `task:updated`
4. If `task.sessionId` existed: kill the PTY (`entry.pty.kill()`), clear debounce timer, delete from `sessions` map
5. Return updated task (200)

Killing the session after updating status ensures the `onExit` handler's guard (`status === "In Progress"`) is already false, so the task does not auto-advance to "Review".

**Response:** `Task` object with `status: "Backlog"` and no `sessionId`.

## Frontend Architecture

### `useTasks.ts` — new hook

```ts
export function useRecallTask(repoId: string) {
  // POST /api/tasks/:id/recall
  // Optimistic update: status → "Backlog", sessionId → undefined
  // Rollback on error
}
```

### `TaskCard.types.ts`

Add `onRecall?: (id: string) => void`.

### `TaskCard.tsx`

- Import `DropdownMenu` from `@radix-ui/react-dropdown-menu`
- Replace the standalone `removeBtn` with a `…` trigger button (same hover-reveal behaviour)
- Render menu items based on `task.status === "In Progress"`
- `onPointerDown` + `stopPropagation` on the trigger to prevent card click/drag

### `TaskCard.module.css`

Add styles for: `.menuTrigger`, `.menuContent`, `.menuItem`, `.menuItemDanger`, `.menuItemWarning`, `.menuSeparator`, `.menuItemSubtext`.

### `Column.types.ts`

Add `onRecall?: (id: string) => void`.

### `Column.tsx`

Pass `onRecall` through to each `TaskCard`.

### `Board.tsx`

- Import `useRecallTask`
- Provide `onRecall` handler: calls `recallTask(taskId)`
- Pass `onRecall` to `Column`

## Files Changed

| File                                                | Change                                 |
| --------------------------------------------------- | -------------------------------------- |
| `server.ts`                                         | Add `POST /api/tasks/:id/recall` route |
| `src/hooks/useTasks.ts`                             | Add `useRecallTask` hook               |
| `src/components/Board/TaskCard/TaskCard.types.ts`   | Add `onRecall` prop                    |
| `src/components/Board/TaskCard/TaskCard.tsx`        | Replace delete btn with `…` dropdown   |
| `src/components/Board/TaskCard/TaskCard.module.css` | Dropdown styles                        |
| `src/components/Board/Column/Column.types.ts`       | Add `onRecall` prop                    |
| `src/components/Board/Column/Column.tsx`            | Thread `onRecall` to cards             |
| `src/components/Board/Board/Board.tsx`              | Wire `useRecallTask`, pass to columns  |

## What is NOT changing

- Backlog cards in the `Backlog` component keep their existing standalone delete button (they are rendered differently from board cards and have no agent session to kill)
- Drag-and-drop between board columns is unchanged
- The `DELETE /api/sessions/:id` endpoint is unchanged (used by the terminal view)
