# Archive Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a task is dragged to "Done" on the board it disappears from the board and appears in a new Archive page; the sidebar Archives link navigates to this page.

**Architecture:** Add `archivedAt` timestamp to the Task type; the server PATCH handler auto-sets it when status becomes "Done" and clears it when status changes to anything else. The Board's Done column stays as a visual drop target but renders zero tasks. The Archive page is a standalone full-page route that lists all Done tasks and lets the user restore them to Backlog. The Sidebar gains an "Archive" view type so its nav item can be highlighted.

**Tech Stack:** Next.js App Router, React 19, TypeScript strict, CSS Modules, TanStack Query v5, Radix UI DropdownMenu, Phosphor Icons, existing `useTasks` / `useUpdateTask` hooks.

---

### Task 1: Add `archivedAt` to Task type

**Files:**

- Modify: `src/utils/tasks.types.ts`

**Step 1: Edit the Task interface and UpdateTaskInput**

In `src/utils/tasks.types.ts`, make these two changes:

1. Add `archivedAt?: string;` to `Task` after `updatedAt`
2. Add `archivedAt` to the `UpdateTaskInput` pick list

```typescript
// src/utils/tasks.types.ts
export type TaskStatus =
  | "Backlog"
  | "Not Started"
  | "In Progress"
  | "Review"
  | "Done";
export type Priority = "Low" | "Medium" | "High" | "Urgent";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  spec: string; // Lexical editor state JSON
  repoId: string; // which repo this task belongs to
  sessionId?: string; // linked Claude PTY session
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  archivedAt?: string; // ISO timestamp, set when status → "Done"
}

export type CreateTaskInput = Pick<Task, "title" | "repoId"> & {
  status?: TaskStatus;
  priority?: Priority;
};
export type UpdateTaskInput = Partial<
  Pick<
    Task,
    "title" | "status" | "priority" | "spec" | "sessionId" | "archivedAt"
  >
>;

export interface Repo {
  id: string; // stable UUID
  name: string; // user-defined display name
  path: string; // absolute path on disk
  createdAt: string; // ISO 8601
}

export type CreateRepoInput = Pick<Repo, "name" | "path">;
export type UpdateRepoInput = Partial<Pick<Repo, "name" | "path">>;
```

**Step 2: Verify TypeScript compiles**

Run: `yarn tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/utils/tasks.types.ts
git commit -m "feat: add archivedAt field to Task type"
```

---

### Task 2: Auto-set `archivedAt` in server PATCH handler

**Files:**

- Modify: `server.ts` (around line 293)

**Step 1: Edit the PATCH handler to stamp archivedAt**

Find the PATCH handler block (around line 293) where `tasks[idx]` is re-assigned:

```typescript
// CURRENT CODE (around line 293):
tasks[idx] = {
  ...tasks[idx],
  ...body,
  id,
  updatedAt: new Date().toISOString(),
} as Task;
```

Replace with:

```typescript
const now = new Date().toISOString();
const becomingDone = body.status === "Done";
const leavingDone =
  body.status !== undefined &&
  body.status !== "Done" &&
  tasks[idx].status === "Done";

tasks[idx] = {
  ...tasks[idx],
  ...body,
  id,
  updatedAt: now,
  archivedAt: becomingDone
    ? (tasks[idx].archivedAt ?? now) // stamp once; don't overwrite if already set
    : leavingDone
      ? undefined // clear when restoring
      : tasks[idx].archivedAt, // unchanged
} as Task;
```

**Step 2: Verify server starts**

Run: `yarn dev`
Expected: Server starts without TypeScript errors. Stop with Ctrl+C.

**Step 3: Manual smoke test**

Start dev server, open the board, drag a task to "Done". Open the tasks.json file to confirm `archivedAt` is now set on that task.

**Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: auto-stamp archivedAt when task status → Done"
```

---

### Task 3: Add "Archive" to the Sidebar view type and wire the link

**Files:**

- Modify: `src/components/Layout/Sidebar/Sidebar.types.ts`
- Modify: `src/components/Layout/Sidebar/Sidebar.tsx`

**Step 1: Add "Archive" to the View union**

In `src/components/Layout/Sidebar/Sidebar.types.ts`:

```typescript
export type View = "Board" | "Tasks" | "Archive";

export interface SidebarProps {
  repoId: string;
  currentView: View;
  agentActive: boolean;
}
```

**Step 2: Wire the Archives nav item in Sidebar.tsx**

The current archive nav item at line 71 has no `onClick`. Replace it with one that navigates and highlights correctly:

```typescript
// Replace line 71:
// <NavItem icon={<Archive size={16} />} label="Archives" />
// With:
<NavItem
  icon={<Archive size={16} />}
  label="Archives"
  active={currentView === "Archive"}
  onClick={() => router.push(`/repos/${repoId}/archive`)}
/>
```

**Step 3: Verify TypeScript compiles**

Run: `yarn tsc --noEmit`
Expected: No errors. (The `View` change will break AppShell only if something passes a literal "Archive" where it wasn't expected — but since we're only reading `currentView` the union expansion is backwards-compatible.)

**Step 4: Commit**

```bash
git add src/components/Layout/Sidebar/Sidebar.types.ts src/components/Layout/Sidebar/Sidebar.tsx
git commit -m "feat: add Archive view type and wire sidebar Archives link"
```

---

### Task 4: Create ArchivePage component

**Files:**

- Create: `src/components/ArchivePage/ArchivePage.tsx`
- Create: `src/components/ArchivePage/ArchivePage.module.css`
- Create: `src/components/ArchivePage/ArchivePage.types.ts`
- Create: `src/components/ArchivePage/index.ts`

**Step 1: Create types file**

`src/components/ArchivePage/ArchivePage.types.ts`:

```typescript
export interface ArchivePageProps {
  repoId: string;
}
```

**Step 2: Create the CSS module**

`src/components/ArchivePage/ArchivePage.module.css`:

```css
/* ─── Shell layout (mirrors AppShell) ────────────────────────────────────── */
.shell {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ─── Content area ───────────────────────────────────────────────────────── */
.content {
  flex: 1;
  overflow-y: auto;
}

.inner {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

/* ─── Header ─────────────────────────────────────────────────────────────── */
.headerRow {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 24px;
}

.heading {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0 0 2px;
  color: var(--color-text);
}

.subheading {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  margin: 0;
}

/* ─── Task list ──────────────────────────────────────────────────────────── */
.list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* ─── Row ────────────────────────────────────────────────────────────────── */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: default;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  transition: border-color 120ms;
}

.row:hover {
  border-color: color-mix(in srgb, var(--color-border) 60%, var(--color-text));
}

.rowLeft {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.rowContent {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.rowTitle {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-decoration: line-through;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rowTitleEmpty {
  font-style: italic;
}

.rowMeta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rowDate {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

/* ─── Priority badge ─────────────────────────────────────────────────────── */
.priority {
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: var(--radius-sm, 4px);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.priorityLow {
  background: #2d333b;
  color: #8b949e;
}
.priorityMedium {
  background: #2d3a1e;
  color: #7ee787;
}
.priorityHigh {
  background: #3d2b1f;
  color: #f0883e;
}
.priorityUrgent {
  background: #3d1f1f;
  color: #f85149;
}

/* ─── Row actions ────────────────────────────────────────────────────────── */
.rowActions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.restoreButton {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-muted);
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm, 4px);
  padding: 3px 10px;
  cursor: pointer;
  transition:
    color 120ms,
    border-color 120ms;
}

.restoreButton:hover {
  color: var(--color-text);
  border-color: color-mix(in srgb, var(--color-border) 50%, var(--color-text));
}

/* ─── Dropdown ───────────────────────────────────────────────────────────── */
.moreButton {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm, 4px);
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 120ms,
    background 120ms;
}

.row:hover .moreButton,
.moreButtonOpen {
  opacity: 1;
}

.moreButton:hover,
.moreButtonOpen {
  background: color-mix(in srgb, var(--color-surface) 80%, var(--color-text));
  color: var(--color-text);
}

.menuContent {
  min-width: 140px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 50;
}

.menuItem {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 6px 8px;
  font-size: 0.8125rem;
  border-radius: var(--radius-sm, 4px);
  border: none;
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  text-align: left;
}

.menuItem:hover {
  background: color-mix(in srgb, var(--color-surface) 60%, var(--color-text));
}

.menuItemDanger {
  color: #f85149;
}
.menuItemDanger:hover {
  background: rgba(248, 81, 73, 0.1);
}

.menuItemLabel {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ─── Empty state ────────────────────────────────────────────────────────── */
.emptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 0;
  color: var(--color-text-muted);
  font-size: 0.875rem;
  text-align: center;
}

.emptyIcon {
  opacity: 0.4;
}
```

**Step 3: Create the component**

`src/components/ArchivePage/ArchivePage.tsx`:

```typescript
"use client";

import { useState } from "react";
import {
  Archive,
  DotsThree,
  Trash,
} from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { Sidebar } from "@/components/Layout/Sidebar";
import { TopBar } from "@/components/Layout/TopBar";
import { useDeleteTask, useTasks, useUpdateTask } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import { formatRelativeDate } from "@/utils/formatRelativeDate";
import type { Priority } from "@/utils/tasks.types";
import styles from "./ArchivePage.module.css";
import type { ArchivePageProps } from "./ArchivePage.types";

const PRIORITY_CLASS: Record<Priority, string> = {
  Low: styles.priorityLow,
  Medium: styles.priorityMedium,
  High: styles.priorityHigh,
  Urgent: styles.priorityUrgent,
};

export function ArchivePage({ repoId }: ArchivePageProps) {
  useTasksSocket();

  const { data: allTasks = [] } = useTasks(repoId);
  const { mutate: updateTask } = useUpdateTask(repoId);
  const { mutate: deleteTask } = useDeleteTask(repoId);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const agentActive = allTasks.some((t) => t.status === "In Progress");
  const archivedTasks = allTasks
    .filter((t) => t.status === "Done")
    .sort((a, b) => {
      const aTime = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
      const bTime = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
      return bTime - aTime; // newest archived first
    });

  function handleRestore(taskId: string) {
    updateTask({ id: taskId, status: "Backlog" });
  }

  return (
    <div className={styles.shell}>
      <Sidebar repoId={repoId} currentView="Archive" agentActive={agentActive} />

      <main className={styles.main}>
        <TopBar repoId={repoId} currentView="Archive" onNewTask={() => undefined} />

        <div className={styles.content}>
          <div className={styles.inner}>
            <div className={styles.headerRow}>
              <div>
                <h1 className={styles.heading}>Archive</h1>
                <p className={styles.subheading}>
                  Completed tasks ({archivedTasks.length})
                </p>
              </div>
            </div>

            <div className={styles.list}>
              {archivedTasks.map((task) => (
                <div key={task.id} className={styles.row}>
                  <div className={styles.rowLeft}>
                    <div className={styles.rowContent}>
                      <span
                        className={`${styles.rowTitle}${!task.title ? ` ${styles.rowTitleEmpty}` : ""}`}
                      >
                        {task.title || "Untitled"}
                      </span>
                      <div className={styles.rowMeta}>
                        <span
                          className={`${styles.priority} ${PRIORITY_CLASS[task.priority]}`}
                        >
                          {task.priority}
                        </span>
                        <span className={styles.rowDate}>
                          Archived{" "}
                          {task.archivedAt
                            ? formatRelativeDate(task.archivedAt)
                            : formatRelativeDate(task.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.rowActions}>
                    <button
                      className={styles.restoreButton}
                      onClick={() => handleRestore(task.id)}
                    >
                      Restore
                    </button>

                    <DropdownMenu.Root
                      open={openMenuId === task.id}
                      onOpenChange={(open) =>
                        setOpenMenuId(open ? task.id : null)
                      }
                    >
                      <DropdownMenu.Trigger asChild>
                        <button
                          className={`${styles.moreButton} ${openMenuId === task.id ? styles.moreButtonOpen : ""}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`More actions for ${task.title}`}
                        >
                          <DotsThree size={16} weight="bold" />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content
                        className={styles.menuContent}
                        align="end"
                        sideOffset={4}
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <DropdownMenu.Item asChild>
                          <button
                            className={`${styles.menuItem} ${styles.menuItemDanger}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteTask(task.id);
                            }}
                          >
                            <span className={styles.menuItemLabel}>
                              <Trash size={13} />
                              Delete
                            </span>
                          </button>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  </div>
                </div>
              ))}

              {archivedTasks.length === 0 && (
                <div className={styles.emptyState}>
                  <Archive size={32} className={styles.emptyIcon} />
                  <p>No archived tasks yet. Drag tasks to Done on the board to archive them.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
```

**Step 4: Create the barrel export**

`src/components/ArchivePage/index.ts`:

```typescript
export { ArchivePage } from "./ArchivePage";
export type { ArchivePageProps } from "./ArchivePage.types";
```

**Step 5: Verify TypeScript compiles**

Run: `yarn tsc --noEmit`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/components/ArchivePage/
git commit -m "feat: add ArchivePage component"
```

---

### Task 5: Create the archive Next.js page route

**Files:**

- Create: `src/app/repos/[repoId]/archive/page.tsx`

**Step 1: Create the page**

`src/app/repos/[repoId]/archive/page.tsx`:

```typescript
import { ArchivePage } from "@/components/ArchivePage";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <ArchivePage repoId={repoId} />;
}
```

**Step 2: Export ArchivePage from the main components barrel**

In `src/components/index.ts`, add:

```typescript
export { ArchivePage } from "./ArchivePage";
```

(Add it alphabetically near the top of the file with other A-exports.)

**Step 3: Verify page renders**

Run `yarn dev`, navigate to `http://localhost:3001/repos/<any-repo-id>/archive`.
Expected: Archive page renders with the sidebar showing "Archives" as active. Empty state visible if no Done tasks exist.

**Step 4: Verify sidebar link works**

Click "Archives" in the sidebar on any page.
Expected: Navigates to `/repos/<repoId>/archive` and the sidebar item is highlighted.

**Step 5: Commit**

```bash
git add src/app/repos/[repoId]/archive/page.tsx src/components/index.ts
git commit -m "feat: add archive route and wire component exports"
```

---

### Task 6: Hide Done tasks from the Board Done column

**Files:**

- Modify: `src/components/Board/Board/Board.tsx` (line 81)

**Step 1: Filter Done tasks out of the Done column display**

In `Board.tsx`, find the Column render (line 77-87):

```typescript
// CURRENT:
{BOARD_COLUMNS.map((status) => (
  <Column
    key={status}
    status={status}
    tasks={tasks.filter((t) => t.status === status)}
    ...
  />
))}
```

Change the tasks prop for the Done column to an empty array so the column acts as a drop zone only:

```typescript
{BOARD_COLUMNS.map((status) => (
  <Column
    key={status}
    status={status}
    tasks={status === "Done" ? [] : tasks.filter((t) => t.status === status)}
    onSelectTask={onSelectTask}
    onRemoveTask={deleteTask}
    onRecall={recallTask}
    onHandover={onHandover}
  />
))}
```

The Done column remains as a droppable zone (the `useDroppable` in Column.tsx is keyed by `status`, not by the tasks list), so drag-and-drop still works. Tasks dropped there will immediately vanish from the board and appear in the archive.

**Step 2: Verify TypeScript compiles**

Run: `yarn tsc --noEmit`
Expected: No errors.

**Step 3: Manual smoke test**

1. Start dev server
2. Open board with some tasks in "In Progress" or "Review"
3. Drag a task to "Done" — it should disappear from the board instantly
4. Navigate to Archives in the sidebar — the task should appear there
5. Click "Restore" — the task should disappear from archive and reappear in Tasks/Backlog

**Step 4: Commit**

```bash
git add src/components/Board/Board/Board.tsx
git commit -m "feat: archive Done tasks — hide from board, show in archive page"
```

---

### Task 7: Fix TopBar to handle "Archive" view gracefully

**Files:**

- Modify: `src/components/Layout/TopBar/TopBar.tsx` (inspect first)

The `TopBar` component currently receives `currentView: View`. Since we added "Archive" to the `View` union, verify that `TopBar` doesn't break (e.g., if it switches on `currentView` to show a "New Task" button only for Tasks/Board, the "Archive" case may need a `default` or explicit handling).

**Step 1: Read TopBar**

Read `src/components/Layout/TopBar/TopBar.tsx` to check how `currentView` is used.

**Step 2: Handle "Archive" view**

If `TopBar` shows the "+ New Task" button based on `currentView`, make sure "Archive" either shows the button or hides it (hiding makes more sense — you wouldn't create a task from the archive). The `ArchivePage` passes `onNewTask={() => undefined}` so no action occurs anyway, but the button shouldn't show.

Likely fix (depends on what you find):

```typescript
// If there's a condition like:
{currentView !== "Board" && <button onClick={onNewTask}>New Task</button>}

// Change to:
{currentView === "Tasks" && <button onClick={onNewTask}>New Task</button>}
```

**Step 3: Verify TypeScript compiles**

Run: `yarn tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/components/Layout/TopBar/TopBar.tsx
git commit -m "fix: hide New Task button on Archive view in TopBar"
```

---

### Task 8: Write tests for ArchivePage

**Files:**

- Create: `src/components/ArchivePage/test.tsx`

**Step 1: Write the failing tests**

`src/components/ArchivePage/test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";

import { ArchivePage } from "./ArchivePage";

// Mock the hooks so we don't need a real server
const mockUpdateTask = jest.fn();
const mockDeleteTask = jest.fn();

jest.mock("@/hooks/useTasks", () => ({
  useTasks: () => ({
    data: [
      {
        id: "TASK-001",
        title: "Finished feature",
        status: "Done",
        priority: "High",
        spec: "",
        repoId: "repo-1",
        createdAt: "2026-02-20T10:00:00.000Z",
        updatedAt: "2026-02-25T10:00:00.000Z",
        archivedAt: "2026-02-25T10:00:00.000Z",
      },
      {
        id: "TASK-002",
        title: "In progress task",
        status: "In Progress",
        priority: "Medium",
        spec: "",
        repoId: "repo-1",
        createdAt: "2026-02-21T10:00:00.000Z",
        updatedAt: "2026-02-25T10:00:00.000Z",
      },
    ],
  }),
  useUpdateTask: () => ({ mutate: mockUpdateTask }),
  useDeleteTask: () => ({ mutate: mockDeleteTask }),
  useHandoverTask: () => ({ mutate: jest.fn() }),
}));

jest.mock("@/hooks/useTasksSocket", () => ({
  useTasksSocket: () => undefined,
}));

jest.mock("@/components/Layout/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

jest.mock("@/components/Layout/TopBar", () => ({
  TopBar: () => <div data-testid="topbar" />,
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe("ArchivePage", () => {
  beforeEach(() => {
    mockUpdateTask.mockClear();
    mockDeleteTask.mockClear();
  });

  it("shows only Done tasks, not In Progress tasks", () => {
    render(<ArchivePage repoId="repo-1" />);
    expect(screen.getByText("Finished feature")).toBeInTheDocument();
    expect(screen.queryByText("In progress task")).not.toBeInTheDocument();
  });

  it("shows archived count in subheading", () => {
    render(<ArchivePage repoId="repo-1" />);
    expect(screen.getByText(/Completed tasks \(1\)/)).toBeInTheDocument();
  });

  it("calls updateTask with status Backlog when Restore is clicked", () => {
    render(<ArchivePage repoId="repo-1" />);
    fireEvent.click(screen.getByText("Restore"));
    expect(mockUpdateTask).toHaveBeenCalledWith({
      id: "TASK-001",
      status: "Backlog",
    });
  });

  it("shows empty state when no Done tasks exist", () => {
    jest.mocked(require("@/hooks/useTasks").useTasks).mockReturnValueOnce({
      data: [],
    });
    render(<ArchivePage repoId="repo-1" />);
    expect(screen.getByText(/No archived tasks yet/)).toBeInTheDocument();
  });
});
```

**Step 2: Run tests to verify they fail (no implementation changes yet needed)**

Run: `yarn test src/components/ArchivePage/test.tsx`
Expected: Tests should fail with module-not-found or similar (since we're confirming they reference real code).

Actually since the component already exists from Task 4, the tests should PASS here. If they fail, fix the mocks to match the actual component API.

Run: `yarn test src/components/ArchivePage/test.tsx`
Expected: All 4 tests PASS.

**Step 3: Commit**

```bash
git add src/components/ArchivePage/test.tsx
git commit -m "test: add ArchivePage unit tests"
```

---

### Task 9: Final end-to-end verification

**Step 1: Run full test suite**

Run: `yarn test`
Expected: All tests pass (no regressions).

**Step 2: Run lint**

Run: `yarn lint`
Expected: 0 warnings, 0 errors.

**Step 3: Run type check**

Run: `yarn tsc --noEmit`
Expected: No errors.

**Step 4: Manual flow test**

1. Start dev server: `yarn dev`
2. Create a new task in the Tasks view
3. Drag it on the board from Backlog → In Progress → Done
4. Verify: task vanishes from board Done column immediately
5. Click "Archives" in sidebar → task appears in Archive page with "Archived [date]" label
6. Click "Restore" → task disappears from archive, reappears in Tasks (Backlog status)
7. Drag to Done again → re-appears in archive
8. Open the three-dot menu on an archived task → click "Delete" → task is removed from archive

**Step 5: Final commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: cleanup after archive feature implementation"
```
