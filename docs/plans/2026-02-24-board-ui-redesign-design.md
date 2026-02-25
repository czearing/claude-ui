# Board UI Redesign & Task Flow Design

**Date**: 2026-02-24
**Status**: Approved

---

## Overview

Implement a full kanban-style task board that integrates with the existing Claude terminal session infrastructure. The board replaces the current home page grid and becomes the primary interface for managing AI-assisted development work.

The design follows a reference implementation provided by the user, adapted to our repo patterns: CSS Modules instead of Tailwind, Phosphor Icons instead of Lucide, TanStack Query + server-side REST instead of Zustand, and Lexical for rich text spec editing.

---

## 1. Data Model

### Task

```ts
type Task = {
  id: string; // 'TASK-001', auto-incremented
  title: string;
  type: "Spec" | "Develop";
  status: "Backlog" | "Not Started" | "In Progress" | "Review" | "Done";
  priority: "Low" | "Medium" | "High" | "Urgent";
  spec: string; // Lexical editor JSON string
  sessionId?: string; // linked Claude session ID, set on handover
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
};
```

**Persistence**: `tasks.json` on the server, read/written by REST endpoints on `server.ts`.

---

## 2. Server Layer

### New REST Endpoints (added to `server.ts`)

| Method   | Path                      | Description                                                  |
| -------- | ------------------------- | ------------------------------------------------------------ |
| `GET`    | `/api/tasks`              | Read all tasks from `tasks.json`                             |
| `POST`   | `/api/tasks`              | Create a new task                                            |
| `PATCH`  | `/api/tasks/:id`          | Update task fields (status, spec, priority, etc.)            |
| `DELETE` | `/api/tasks/:id`          | Delete a task                                                |
| `POST`   | `/api/tasks/:id/handover` | Create Claude PTY session, link to task, move to In Progress |

### Handover Flow (server-side)

1. Read spec from task
2. Spawn a new PTY session (`claude --dangerously-skip-permissions`) with the spec as the initial prompt
3. Register the session in the existing session store
4. Patch task: `sessionId = newSessionId`, `status = 'In Progress'`
5. Broadcast `task:updated` via WebSocket
6. When the PTY process exits → patch task `status = 'Review'`, broadcast `task:updated`

### WebSocket Task Events

Extend the existing WS server to broadcast task change events on the `task:*` channel:

- `task:created` — new task added
- `task:updated` — any task field changed
- `task:deleted` — task removed

Clients receive these events and call `queryClient.invalidateQueries(['tasks'])` to refetch.

---

## 3. Client Architecture

### State Management

TanStack Query manages all task data. No Zustand.

**Hooks** (`src/hooks/`):

| Hook                | Query/Mutation        | Endpoint                               |
| ------------------- | --------------------- | -------------------------------------- |
| `useTasks()`        | Query `['tasks']`     | `GET /api/tasks`                       |
| `useCreateTask()`   | Mutation              | `POST /api/tasks`                      |
| `useUpdateTask()`   | Mutation (optimistic) | `PATCH /api/tasks/:id`                 |
| `useDeleteTask()`   | Mutation (optimistic) | `DELETE /api/tasks/:id`                |
| `useHandoverTask()` | Mutation              | `POST /api/tasks/:id/handover`         |
| `useTasksSocket()`  | WS subscription       | Invalidates `['tasks']` on task events |

### Component Tree

```
src/app/page.tsx                 ← renders AppShell (replaces current HomePage)
src/components/
  Layout/
    Sidebar/                     ← nav: Board | Backlog | agent status indicator
    TopBar/                      ← breadcrumb, search input, New Issue button
  Board/
    Board/                       ← DnD context, renders 4 columns (Not Started → Done)
    Column/                      ← droppable column with header + task count badge
    TaskCard/                    ← sortable card, agent-pulse animation, Open Terminal link
    Backlog/                     ← separate view: task list + inline draft create form
  Editor/
    SpecEditor/                  ← slide-in right drawer, shows spec + agent notes
    LexicalEditor/               ← Lexical wrapper (edit mode + read-only mode)
  Modals/
    NewIssueModal/               ← Radix Dialog for creating tasks with title/type/priority
```

### Routing

- `/` — AppShell with Board or Backlog view (controlled by sidebar selection)
- `/session/[id]` — existing terminal view (unchanged)

"In Progress" task cards show an "Open Terminal →" link that navigates to `/session/[sessionId]`.

---

## 4. Board Workflow

```
[Backlog] → user writes spec → "Handover to Claude" → [Not Started]
[Not Started] → server picks up → spawns PTY → [In Progress]
[In Progress] → PTY exits → server auto-advances → [Review]
[Review] → user approves → drags or clicks "Mark Done" → [Done]
```

### Drag-and-Drop Constraints

- All columns are droppable by the user
- "In Progress" shows a tooltip warning if user tries to drag into it manually (Claude owns that column)
- "Done" is always manually droppable

---

## 5. Design System

### Tokens Added to `global.css`

```css
/* Spacing */
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-5: 20px;  --space-6: 24px;
--space-8: 32px;

/* Border radius */
--radius-sm: 4px;  --radius-md: 6px;
--radius-lg: 10px; --radius-xl: 12px;

/* Typography */
--text-xs: 11px;  --text-sm: 13px;  --text-base: 14px;

/* New color token (if not present) */
--color-agent-light: rgba(124, 58, 237, 0.2);

/* New animations */
@keyframes shimmer { ... }
```

### CSS Modules Pattern

Tailwind utility classes translate to CSS Module classes:

```css
/* Column.module.css */
.column {
  display: flex;
  flex-direction: column;
  width: 320px;
  flex-shrink: 0;
  height: 100%;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
  padding: 0 var(--space-1);
}
.dropZone {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  border-radius: var(--radius-xl);
  padding: var(--space-2);
  transition: background-color 200ms;
}
.dropZoneOver {
  background-color: var(--color-agent-light);
}
```

### Icons

All Lucide references replaced with Phosphor equivalents:

| Lucide        | Phosphor          |
| ------------- | ----------------- |
| `Plus`        | `Plus`            |
| `X`           | `X`               |
| `Search`      | `MagnifyingGlass` |
| `FileText`    | `FileText`        |
| `Code`        | `Code`            |
| `Send`        | `PaperPlaneTilt`  |
| `Bot`         | `Robot`           |
| `Activity`    | `Activity`        |
| `User`        | `User`            |
| `Settings`    | `Gear`            |
| `LayoutGrid`  | `SquaresFour`     |
| `CheckSquare` | `CheckSquare`     |
| `Archive`     | `Archive`         |
| `Filter`      | `Funnel`          |
| `AlertCircle` | `Warning`         |

---

## 6. Dependencies to Add

| Package          | Purpose               |
| ---------------- | --------------------- |
| `@lexical/react` | Rich text spec editor |
| `lexical`        | Lexical core          |

DnD Kit, Radix UI, TanStack Query, clsx, Phosphor Icons — all already installed.

---

## 7. Files Affected

### New Files

- `src/utils/tasks.types.ts`
- `src/hooks/useTasks.ts`
- `src/hooks/useTasksSocket.ts`
- `src/components/Layout/Sidebar/` (full component folder)
- `src/components/Layout/TopBar/` (full component folder)
- `src/components/Board/Board/` (full component folder)
- `src/components/Board/Column/` (full component folder)
- `src/components/Board/TaskCard/` (full component folder)
- `src/components/Board/Backlog/` (full component folder)
- `src/components/Editor/SpecEditor/` (full component folder)
- `src/components/Editor/LexicalEditor/` (full component folder)
- `src/components/Modals/NewIssueModal/` (full component folder)

### Modified Files

- `server.ts` — add task REST endpoints, handover logic, WS task broadcasts
- `src/app/page.tsx` — render AppShell instead of HomePage
- `src/app/layout.tsx` — ensure font variables match reference
- `src/app/global.css` — add spacing/radius/type tokens, shimmer animation
- `src/components/index.ts` — add new barrel exports
