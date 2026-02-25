# Multi-Repo Workspaces Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-repo workspace support where each repo has its own board scoped by URL (`/repos/[repoId]`), switching repos never interrupts running Claude instances, and a sidebar `RepoSwitcher` lets users add/select repos.

**Architecture:** URL-based routing — active repo is always `/repos/[repoId]`. Server persists repos in `repos.json` alongside `tasks.json`. Every task gains a `repoId` field; PTY sessions spawn in the task's repo directory. Client state is scoped by `repoId` in TanStack Query keys.

**Tech Stack:** Next.js 15 App Router (`useParams`), TanStack Query v5 (`["tasks", repoId]` keys), Radix UI (`DropdownMenu` + `Dialog`), node-pty (cwd change), Phosphor Icons, CSS Modules.

---

## Task 1: Add Repo types and update Task type

**Files:**
- Modify: `src/utils/tasks.types.ts`

**Step 1: Add `Repo` interface and `repoId` to `Task`**

Replace the contents of `src/utils/tasks.types.ts`:

```typescript
// src/utils/tasks.types.ts
export type TaskStatus =
  | "Backlog"
  | "Not Started"
  | "In Progress"
  | "Review"
  | "Done";
export type TaskType = "Spec" | "Develop";
export type Priority = "Low" | "Medium" | "High" | "Urgent";

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  spec: string; // Lexical editor state JSON
  repoId: string; // which repo this task belongs to
  sessionId?: string; // linked Claude PTY session
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export type CreateTaskInput = Pick<Task, "title" | "type" | "priority" | "repoId"> & {
  status?: TaskStatus;
};
export type UpdateTaskInput = Partial<
  Pick<Task, "title" | "type" | "status" | "priority" | "spec" | "sessionId">
>;

export interface Repo {
  id: string;    // stable UUID
  name: string;  // user-defined display name
  path: string;  // absolute path on disk
  createdAt: string; // ISO 8601
}

export type CreateRepoInput = Pick<Repo, "name" | "path">;
export type UpdateRepoInput = Partial<Pick<Repo, "name" | "path">>;
```

**Step 2: Verify TypeScript compiles**

Run: `yarn tsc --noEmit`

Expect: errors about `repoId` being missing from existing `CreateTaskInput` usages — that's fine, you'll fix them in later tasks. If there are *other* unexpected errors, investigate before continuing.

**Step 3: Commit**

```bash
git add src/utils/tasks.types.ts
git commit -m "feat: add Repo type and repoId field to Task"
```

---

## Task 2: Server — repos persistence and startup migration

**Files:**
- Modify: `server.ts`

**Step 1: Add Repo type and file path to server.ts**

After the `TASKS_FILE` constant (line 38), add:

```typescript
const REPOS_FILE = join(process.cwd(), "repos.json");

interface Repo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

async function readRepos(): Promise<Repo[]> {
  try {
    const raw = await readFile(REPOS_FILE, "utf8");
    return JSON.parse(raw) as Repo[];
  } catch {
    return [];
  }
}

async function writeRepos(repos: Repo[]): Promise<void> {
  await writeFile(REPOS_FILE, JSON.stringify(repos, null, 2), "utf8");
}
```

Also add `repoId` to the server-side `Task` interface (line 44):

```typescript
interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  spec: string;
  repoId: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}
```

**Step 2: Add startup migration function**

Add this function after `writeRepos`:

```typescript
async function ensureDefaultRepo(): Promise<void> {
  const repos = await readRepos();
  if (repos.length > 0) return;

  const defaultRepo: Repo = {
    id: randomUUID(),
    name: "Default",
    path: process.cwd(),
    createdAt: new Date().toISOString(),
  };
  await writeRepos([defaultRepo]);

  // Migrate existing tasks that have no repoId
  const tasks = await readTasks();
  const needsMigration = tasks.some((t) => !t.repoId);
  if (needsMigration) {
    const migrated = tasks.map((t) =>
      t.repoId ? t : { ...t, repoId: defaultRepo.id },
    );
    await writeTasks(migrated);
  }
}
```

**Step 3: Call migration at startup**

Inside `app.prepare().then(async () => {`, add as the first statement:

```typescript
await ensureDefaultRepo();
```

**Step 4: Verify server starts**

Run: `yarn dev`

Expected: server starts, `repos.json` is created with one entry, existing `tasks.json` tasks all have `repoId` set.

Check: `cat repos.json` should show a single repo with the current directory as `path`.

**Step 5: Commit**

```bash
git add server.ts
git commit -m "feat: add repos persistence and startup migration to server"
```

---

## Task 3: Server — repos REST endpoints

**Files:**
- Modify: `server.ts`

**Step 1: Add `fs` import**

At the top of `server.ts`, the `node:fs/promises` import is already there. Add `existsSync` from `node:fs` (sync):

```typescript
import { existsSync } from "node:fs";
```

**Step 2: Add repo endpoints**

Add these handlers inside the `createServer` callback, *before* the `void handle(req, res, parsedUrl)` fallthrough line. Add them after the `DELETE /api/sessions/:id` block:

```typescript
// GET /api/repos
if (req.method === "GET" && parsedUrl.pathname === "/api/repos") {
  const repos = await readRepos();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(repos));
  return;
}

// POST /api/repos
if (req.method === "POST" && parsedUrl.pathname === "/api/repos") {
  const body = await readBody(req);
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const path = typeof body["path"] === "string" ? body["path"].trim() : "";
  if (!name || !path) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "name and path are required" }));
    return;
  }
  if (!existsSync(path)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Path does not exist: ${path}` }));
    return;
  }
  const repos = await readRepos();
  const repo: Repo = {
    id: randomUUID(),
    name,
    path,
    createdAt: new Date().toISOString(),
  };
  repos.push(repo);
  await writeRepos(repos);
  broadcastTaskEvent("repo:created", repo);
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify(repo));
  return;
}

// PATCH /api/repos/:id
if (
  req.method === "PATCH" &&
  parsedUrl.pathname?.startsWith("/api/repos/")
) {
  const id = parsedUrl.pathname.slice("/api/repos/".length);
  const body = await readBody(req);
  const repos = await readRepos();
  const idx = repos.findIndex((r) => r.id === id);
  if (idx === -1) {
    res.writeHead(404);
    res.end();
    return;
  }
  if (typeof body["path"] === "string" && !existsSync(body["path"] as string)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: `Path does not exist: ${body["path"] as string}` }),
    );
    return;
  }
  repos[idx] = { ...repos[idx], ...body, id } as Repo;
  await writeRepos(repos);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(repos[idx]));
  return;
}

// DELETE /api/repos/:id
if (
  req.method === "DELETE" &&
  parsedUrl.pathname?.startsWith("/api/repos/")
) {
  const id = parsedUrl.pathname.slice("/api/repos/".length);
  const repos = await readRepos();
  const filtered = repos.filter((r) => r.id !== id);
  await writeRepos(filtered);
  broadcastTaskEvent("repo:deleted", { id });
  res.writeHead(204);
  res.end();
  return;
}
```

**Step 3: Manual verification**

With `yarn dev` running:

```bash
# List repos
curl http://localhost:3000/api/repos

# Create a repo (use a real path on your machine)
curl -X POST http://localhost:3000/api/repos \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","path":"C:/Code/Personal/claude-code-ui"}'

# Bad path — expect 400
curl -X POST http://localhost:3000/api/repos \
  -H "Content-Type: application/json" \
  -d '{"name":"Bad","path":"/does/not/exist"}'
```

**Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: add repos REST endpoints to server"
```

---

## Task 4: Server — scope tasks by repoId and fix handover cwd

**Files:**
- Modify: `server.ts`

**Step 1: Filter tasks by repoId in GET /api/tasks**

Find the `GET /api/tasks` handler (around line 160). Replace:

```typescript
// GET /api/tasks
if (req.method === "GET" && parsedUrl.pathname === "/api/tasks") {
  const tasks = await readTasks();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(tasks));
  return;
}
```

With:

```typescript
// GET /api/tasks
if (req.method === "GET" && parsedUrl.pathname === "/api/tasks") {
  const tasks = await readTasks();
  const repoId = parsedUrl.query["repoId"] as string | undefined;
  const result = repoId ? tasks.filter((t) => t.repoId === repoId) : tasks;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
  return;
}
```

**Step 2: Accept repoId in POST /api/tasks**

Find the `POST /api/tasks` handler. Update the task construction to include `repoId`:

```typescript
const task: Task = {
  id: generateTaskId(tasks),
  title: typeof body["title"] === "string" ? body["title"] : "",
  type: (body["type"] as TaskType) ?? "Spec",
  status: (body["status"] as TaskStatus) ?? "Backlog",
  priority: (body["priority"] as Priority) ?? "Medium",
  spec: typeof body["spec"] === "string" ? body["spec"] : "",
  repoId: typeof body["repoId"] === "string" ? body["repoId"] : "default",
  createdAt: now,
  updatedAt: now,
};
```

**Step 3: Include repoId in task:deleted broadcast**

Find the `DELETE /api/tasks/:id` handler. Update the broadcast:

```typescript
const taskToDelete = tasks.find((t) => t.id === id);
const filtered = tasks.filter((t) => t.id !== id);
await writeTasks(filtered);
broadcastTaskEvent("task:deleted", { id, repoId: taskToDelete?.repoId });
```

**Step 4: Fix handover to use repo path as cwd**

Find the `POST /api/tasks/:id/handover` handler. Replace the `pty.spawn` call:

```typescript
// Look up the repo path for this task
const repos = await readRepos();
const repo = repos.find((r) => r.id === task.repoId);
const cwd = repo?.path ?? process.cwd();

let ptyProcess: pty.IPty;
try {
  ptyProcess = pty.spawn(
    command,
    ["--dangerously-skip-permissions"],
    {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    },
  );
} catch (err) {
  res.writeHead(500, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: String(err) }));
  return;
}
```

**Step 5: Verify with curl**

```bash
# Get tasks for a specific repo
curl "http://localhost:3000/api/tasks?repoId=<id-from-repos.json>"
```

**Step 6: Commit**

```bash
git add server.ts
git commit -m "feat: scope tasks by repoId, fix handover cwd to use repo path"
```

---

## Task 5: Client — `useRepos` hook

**Files:**
- Create: `src/hooks/useRepos.ts`

**Step 1: Create the hook file**

```typescript
// src/hooks/useRepos.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CreateRepoInput, Repo } from "@/utils/tasks.types";

const REPOS_KEY = ["repos"] as const;

async function fetchRepos(): Promise<Repo[]> {
  const res = await fetch("/api/repos");
  if (!res.ok) throw new Error("Failed to fetch repos");
  return res.json() as Promise<Repo[]>;
}

export function useRepos() {
  return useQuery({ queryKey: REPOS_KEY, queryFn: fetchRepos });
}

export function useCreateRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRepoInput) =>
      fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).then(async (r) => {
        if (!r.ok) {
          const err = (await r.json()) as { error: string };
          throw new Error(err.error);
        }
        return r.json() as Promise<Repo>;
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REPOS_KEY }),
  });
}

export function useDeleteRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/repos/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REPOS_KEY }),
  });
}
```

**Step 2: Verify TypeScript compiles**

Run: `yarn tsc --noEmit`

Expected: no new errors from this file.

**Step 3: Commit**

```bash
git add src/hooks/useRepos.ts
git commit -m "feat: add useRepos hook for repo CRUD"
```

---

## Task 6: Client — update `useTasks` and `useTasksSocket` for repoId scoping

**Files:**
- Modify: `src/hooks/useTasks.ts`
- Modify: `src/hooks/useTasksSocket.ts`

**Step 1: Update useTasks to accept repoId**

Replace `src/hooks/useTasks.ts` entirely:

```typescript
// src/hooks/useTasks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateTaskInput,
  Task,
  UpdateTaskInput,
} from "@/utils/tasks.types";

function tasksKey(repoId: string) {
  return ["tasks", repoId] as const;
}

async function fetchTasks(repoId: string): Promise<Task[]> {
  const res = await fetch(`/api/tasks?repoId=${encodeURIComponent(repoId)}`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json() as Promise<Task[]>;
}

export function useTasks(repoId: string) {
  return useQuery({
    queryKey: tasksKey(repoId),
    queryFn: () => fetchTasks(repoId),
    enabled: !!repoId,
  });
}

export function useCreateTask(repoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateTaskInput, "repoId">) =>
      fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, repoId }),
      }).then((r) => r.json()) as Promise<Task>,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repoId) }),
  });
}

export function useUpdateTask(repoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) =>
      fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).then((r) => r.json()) as Promise<Task>,
    onMutate: async ({ id, ...input }) => {
      await queryClient.cancelQueries({ queryKey: tasksKey(repoId) });
      const previous = queryClient.getQueryData<Task[]>(tasksKey(repoId));
      queryClient.setQueryData<Task[]>(tasksKey(repoId), (old) =>
        (old ?? []).map((t) =>
          t.id === id
            ? { ...t, ...input, updatedAt: new Date().toISOString() }
            : t,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(tasksKey(repoId), context.previous);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repoId) }),
  });
}

export function useDeleteTask(repoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/tasks/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: tasksKey(repoId) });
      const previous = queryClient.getQueryData<Task[]>(tasksKey(repoId));
      queryClient.setQueryData<Task[]>(tasksKey(repoId), (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(tasksKey(repoId), context.previous);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repoId) }),
  });
}

export function useHandoverTask(repoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/tasks/${id}/handover`, { method: "POST" }).then((r) =>
        r.json(),
      ) as Promise<Task>,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repoId) }),
  });
}
```

**Step 2: Update useTasksSocket to scope invalidation by repoId**

Replace `src/hooks/useTasksSocket.ts` entirely:

```typescript
// src/hooks/useTasksSocket.ts
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { Task } from "@/utils/tasks.types";

type TaskEvent =
  | { type: "task:created"; data: Task }
  | { type: "task:updated"; data: Task }
  | { type: "task:deleted"; data: { id: string; repoId?: string } }
  | { type: "repo:created" | "repo:deleted"; data: unknown };

export function useTasksSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/board`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as TaskEvent;
        if (msg.type === "task:created" || msg.type === "task:updated") {
          void queryClient.invalidateQueries({
            queryKey: ["tasks", msg.data.repoId],
          });
        } else if (msg.type === "task:deleted") {
          if (msg.data.repoId) {
            void queryClient.invalidateQueries({
              queryKey: ["tasks", msg.data.repoId],
            });
          } else {
            void queryClient.invalidateQueries({ queryKey: ["tasks"] });
          }
        } else if (
          msg.type === "repo:created" ||
          msg.type === "repo:deleted"
        ) {
          void queryClient.invalidateQueries({ queryKey: ["repos"] });
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    return () => ws.close();
  }, [queryClient]);
}
```

**Step 3: Verify TypeScript**

Run: `yarn tsc --noEmit`

Expected: errors about callers of `useTasks()`, `useCreateTask()`, etc. missing the `repoId` argument — you will fix those in Task 8.

**Step 4: Commit**

```bash
git add src/hooks/useTasks.ts src/hooks/useTasksSocket.ts
git commit -m "feat: scope useTasks and useTasksSocket by repoId"
```

---

## Task 7: Client — new routing structure

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/repos/[repoId]/page.tsx`
- Create: `src/app/repos/[repoId]/session/[sessionId]/page.tsx`
- Create: `src/app/repos/[repoId]/session/[sessionId]/SessionPage.tsx`
- Create: `src/app/repos/[repoId]/session/[sessionId]/SessionPage.module.css`

**Step 1: Update root `page.tsx` to redirect**

Replace `src/app/page.tsx`:

```typescript
// src/app/page.tsx
import { redirect } from "next/navigation";

async function getFirstRepoId(): Promise<string | null> {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/repos`, { cache: "no-store" });
    if (!res.ok) return null;
    const repos = (await res.json()) as { id: string }[];
    return repos[0]?.id ?? null;
  } catch {
    return null;
  }
}

export default async function Page() {
  const firstRepoId = await getFirstRepoId();
  if (firstRepoId) {
    redirect(`/repos/${firstRepoId}`);
  }
  // Fallback: no repos yet (shouldn't happen after migration, but just in case)
  redirect("/repos/setup");
}
```

**Step 2: Create the repo board page**

Create `src/app/repos/[repoId]/page.tsx`:

```typescript
// src/app/repos/[repoId]/page.tsx
import { AppShell } from "@/app/AppShell";

export default async function Page({
  params,
}: {
  params: Promise<{ repoId: string }>;
}) {
  const { repoId } = await params;
  return <AppShell repoId={repoId} />;
}
```

**Step 3: Copy SessionPage to new route location**

Create `src/app/repos/[repoId]/session/[sessionId]/SessionPage.tsx` — this is identical to the existing one except the back link points to the repo board:

```typescript
// src/app/repos/[repoId]/session/[sessionId]/SessionPage.tsx
"use client";

import { use, useState } from "react";
import Link from "next/link";

import { TerminalPage } from "@/app/TerminalPage";
import { StatusIndicator } from "@/components";
import type { ClaudeStatus } from "@/hooks/useTerminalSocket.types";

import styles from "./SessionPage.module.css";

type SessionPageProps = {
  params: Promise<{ repoId: string; sessionId: string }>;
};

export const SessionPage = ({ params }: SessionPageProps) => {
  const { repoId, sessionId } = use(params);
  const [status, setStatus] = useState<ClaudeStatus>("connecting");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link
          href={`/repos/${repoId}`}
          className={styles.backLink}
          aria-label="Back to board"
        >
          ← Back
        </Link>
        <StatusIndicator status={status} />
      </header>
      <div className={styles.terminal}>
        <TerminalPage sessionId={sessionId} onStatus={setStatus} />
      </div>
    </div>
  );
};
```

**Step 4: Copy the SessionPage CSS**

Read `src/app/session/[id]/SessionPage.module.css` and copy its contents exactly to `src/app/repos/[repoId]/session/[sessionId]/SessionPage.module.css`.

**Step 5: Create the new session page route**

Create `src/app/repos/[repoId]/session/[sessionId]/page.tsx`:

```typescript
// src/app/repos/[repoId]/session/[sessionId]/page.tsx
import { SessionPage } from "./SessionPage";

export default function Page({
  params,
}: {
  params: Promise<{ repoId: string; sessionId: string }>;
}) {
  return <SessionPage params={params} />;
}
```

**Step 6: Verify the dev server routes work**

Run: `yarn dev`

Navigate to `http://localhost:3000` — should redirect to `/repos/<id>`.

Navigate to `/repos/<id>` — should render the board (will have TypeScript errors until Task 8 is done).

**Step 7: Commit**

```bash
git add src/app/page.tsx \
        "src/app/repos/[repoId]/page.tsx" \
        "src/app/repos/[repoId]/session/[sessionId]/page.tsx" \
        "src/app/repos/[repoId]/session/[sessionId]/SessionPage.tsx" \
        "src/app/repos/[repoId]/session/[sessionId]/SessionPage.module.css"
git commit -m "feat: add /repos/[repoId] routing and new session route"
```

---

## Task 8: Client — update `AppShell` to accept and scope by `repoId`

**Files:**
- Modify: `src/app/AppShell.tsx`

**Step 1: Update AppShell to take repoId and pass to hooks**

Replace `src/app/AppShell.tsx`:

```typescript
// src/app/AppShell.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Backlog } from "@/components/Board/Backlog";
import { Board } from "@/components/Board/Board";
import { SpecEditor } from "@/components/Editor/SpecEditor";
import { Sidebar, type View } from "@/components/Layout/Sidebar";
import { TopBar } from "@/components/Layout/TopBar";
import { useTasks } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import { useHandoverTask } from "@/hooks/useTasks";
import type { Task } from "@/utils/tasks.types";
import styles from "./AppShell.module.css";

interface AppShellProps {
  repoId: string;
}

export function AppShell({ repoId }: AppShellProps) {
  const { data: tasks = [] } = useTasks(repoId);
  const [currentView, setCurrentView] = useState<View>("Board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [focusBacklogCreate, setFocusBacklogCreate] = useState(false);
  const router = useRouter();
  const handoverTask = useHandoverTask(repoId);

  useTasksSocket();

  const agentActive = tasks.some((t) => t.status === "In Progress");

  function handleNewTask() {
    setCurrentView("Backlog");
    setFocusBacklogCreate(true);
  }

  function handleHandover(taskId: string) {
    handoverTask.mutate(taskId, {
      onSuccess: (task) => {
        if (task.sessionId) {
          router.push(`/repos/${repoId}/session/${task.sessionId}`);
        }
      },
    });
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        repoId={repoId}
        currentView={currentView}
        agentActive={agentActive}
        onViewChange={setCurrentView}
      />

      <main className={styles.main}>
        <TopBar currentView={currentView} onNewTask={handleNewTask} />

        <div className={styles.content}>
          {currentView === "Board" ? (
            <Board
              tasks={tasks.filter((t) => t.status !== "Backlog")}
              onSelectTask={setSelectedTask}
              onHandover={handleHandover}
            />
          ) : (
            <Backlog
              repoId={repoId}
              onSelectTask={setSelectedTask}
              focusCreate={focusBacklogCreate}
              onFocused={() => setFocusBacklogCreate(false)}
            />
          )}

          {selectedTask && (
            <div
              className={styles.backdrop}
              onClick={() => setSelectedTask(null)}
            />
          )}

          <SpecEditor
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
          />
        </div>
      </main>
    </div>
  );
}
```

**Step 2: Check what Board, Backlog, and Sidebar expect**

Run `yarn tsc --noEmit` and read the errors. The compiler will tell you exactly which props are missing or unexpected on `Board`, `Backlog`, and `Sidebar`. Fix them in the next tasks — for now just note what needs updating.

**Step 3: Commit AppShell**

```bash
git add src/app/AppShell.tsx
git commit -m "feat: update AppShell to accept repoId and scope all queries"
```

---

## Task 9: Client — update `Backlog` and `Board` for repoId

**Files:**
- Modify: `src/components/Board/Backlog/Backlog.tsx`
- Modify: `src/components/Board/Board/Board.tsx` (if it calls mutations directly)

**Step 1: Read current Backlog.tsx**

Read `src/components/Board/Backlog/Backlog.tsx` to understand its current props and which hooks it calls.

**Step 2: Add repoId prop to Backlog**

Find where `Backlog` calls `useCreateTask()`, `useUpdateTask()`, `useDeleteTask()` — pass `repoId` to each. Add `repoId: string` to `BacklogProps`.

Example pattern (adapt to actual file):

```typescript
// Before
const createTask = useCreateTask();
// After
const createTask = useCreateTask(repoId);
```

**Step 3: Add repoId prop to Board if needed**

Read `src/components/Board/Board/Board.tsx`. If it calls any task mutation hooks directly, add `repoId` prop and pass it through. If it only receives tasks as props and calls callbacks, it may not need changes.

**Step 4: Add onHandover prop to Board if not already there**

If the Board needs to trigger task handover (e.g. from a task card button), add `onHandover?: (taskId: string) => void` to `BoardProps` and wire it through to `TaskCard`.

**Step 5: Verify TypeScript**

Run: `yarn tsc --noEmit`

Expected: remaining errors should only be in the Sidebar (Task 10).

**Step 6: Commit**

```bash
git add src/components/Board/Backlog/Backlog.tsx \
        src/components/Board/Board/Board.tsx
git commit -m "feat: pass repoId through Backlog and Board components"
```

---

## Task 10: Client — `RepoSwitcher` component

**Files:**
- Create: `src/components/Layout/Sidebar/RepoSwitcher/RepoSwitcher.tsx`
- Create: `src/components/Layout/Sidebar/RepoSwitcher/RepoSwitcher.types.ts`
- Create: `src/components/Layout/Sidebar/RepoSwitcher/RepoSwitcher.module.css`
- Create: `src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/AddRepoDialog.tsx`
- Create: `src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/AddRepoDialog.types.ts`
- Create: `src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/AddRepoDialog.module.css`
- Create: `src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/index.ts`
- Create: `src/components/Layout/Sidebar/RepoSwitcher/index.ts`

**Step 1: Create AddRepoDialog types**

```typescript
// src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/AddRepoDialog.types.ts
export interface AddRepoDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (repoId: string) => void;
}
```

**Step 2: Create AddRepoDialog component**

```typescript
// src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/AddRepoDialog.tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

import { useCreateRepo } from "@/hooks/useRepos";
import type { AddRepoDialogProps } from "./AddRepoDialog.types";
import styles from "./AddRepoDialog.module.css";

export function AddRepoDialog({ open, onClose, onCreated }: AddRepoDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const createRepo = useCreateRepo();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createRepo.mutate(
      { name: name.trim(), path: path.trim() },
      {
        onSuccess: (repo) => {
          setName("");
          setPath("");
          onCreated(repo.id);
        },
      },
    );
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setName("");
      setPath("");
      createRepo.reset();
      onClose();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>Add repo</Dialog.Title>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="repo-name" className={styles.label}>
                Name
              </label>
              <input
                id="repo-name"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Frontend"
                required
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="repo-path" className={styles.label}>
                Path
              </label>
              <input
                id="repo-path"
                className={styles.input}
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Users/you/code/my-app"
                required
              />
              {createRepo.error && (
                <span className={styles.error}>
                  {createRepo.error.message}
                </span>
              )}
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.cancel}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.submit}
                disabled={createRepo.isPending}
              >
                {createRepo.isPending ? "Adding…" : "Add repo"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

**Step 3: Create AddRepoDialog CSS**

```css
/* src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/AddRepoDialog.module.css */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 50;
}

.content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  width: 400px;
  z-index: 51;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-text);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.label {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text);
  width: 100%;
}

.input:focus {
  outline: none;
  border-color: var(--color-agent);
}

.error {
  font-size: var(--text-xs);
  color: var(--color-danger, #f85149);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

.cancel {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  cursor: pointer;
}

.cancel:hover {
  background: var(--color-border);
}

.submit {
  background: var(--color-agent);
  border: none;
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  color: white;
  cursor: pointer;
  font-weight: 500;
}

.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**Step 4: Create AddRepoDialog barrel**

```typescript
// src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/index.ts
export * from "./AddRepoDialog";
```

**Step 5: Create RepoSwitcher types**

```typescript
// src/components/Layout/Sidebar/RepoSwitcher/RepoSwitcher.types.ts
export interface RepoSwitcherProps {
  activeRepoId: string;
}
```

**Step 6: Create RepoSwitcher component**

```typescript
// src/components/Layout/Sidebar/RepoSwitcher/RepoSwitcher.tsx
"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CaretUpDown, Check, Plus } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useRepos } from "@/hooks/useRepos";
import { AddRepoDialog } from "./AddRepoDialog";
import type { RepoSwitcherProps } from "./RepoSwitcher.types";
import styles from "./RepoSwitcher.module.css";

export function RepoSwitcher({ activeRepoId }: RepoSwitcherProps) {
  const { data: repos = [] } = useRepos();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);

  const activeRepo = repos.find((r) => r.id === activeRepoId);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.trigger}>
            <span className={styles.repoName}>
              {activeRepo?.name ?? "Select repo"}
            </span>
            <CaretUpDown size={12} className={styles.caret} />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.menu}
            side="bottom"
            align="start"
            sideOffset={4}
          >
            {repos.map((repo) => (
              <DropdownMenu.Item
                key={repo.id}
                className={styles.item}
                onSelect={() => router.push(`/repos/${repo.id}`)}
              >
                <span className={styles.itemName}>{repo.name}</span>
                {repo.id === activeRepoId && (
                  <Check size={12} className={styles.checkIcon} />
                )}
              </DropdownMenu.Item>
            ))}

            {repos.length > 0 && (
              <DropdownMenu.Separator className={styles.separator} />
            )}

            <DropdownMenu.Item
              className={styles.addItem}
              onSelect={() => setAddOpen(true)}
            >
              <Plus size={12} />
              <span>Add repo</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <AddRepoDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(repoId) => {
          setAddOpen(false);
          router.push(`/repos/${repoId}`);
        }}
      />
    </>
  );
}
```

**Step 7: Create RepoSwitcher CSS**

```css
/* src/components/Layout/Sidebar/RepoSwitcher/RepoSwitcher.module.css */
.trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  background: var(--color-border);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--color-text);
  transition: background-color 150ms;
}

.trigger:hover {
  background: var(--color-surface-hover, var(--color-border));
  filter: brightness(1.15);
}

.repoName {
  font-size: var(--text-sm);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caret {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.menu {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-1);
  min-width: 200px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 100;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  color: var(--color-text);
  outline: none;
}

.item[data-highlighted] {
  background: var(--color-border);
}

.itemName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.checkIcon {
  flex-shrink: 0;
  color: var(--color-agent);
}

.separator {
  height: 1px;
  background: var(--color-border);
  margin: var(--space-1) 0;
}

.addItem {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  color: var(--color-text-muted);
  outline: none;
}

.addItem[data-highlighted] {
  background: var(--color-border);
  color: var(--color-text);
}
```

**Step 8: Create RepoSwitcher barrel**

```typescript
// src/components/Layout/Sidebar/RepoSwitcher/index.ts
export * from "./RepoSwitcher";
```

**Step 9: Commit**

```bash
git add src/components/Layout/Sidebar/RepoSwitcher/
git commit -m "feat: add RepoSwitcher and AddRepoDialog components"
```

---

## Task 11: Client — update `Sidebar` to include `RepoSwitcher`

**Files:**
- Modify: `src/components/Layout/Sidebar/Sidebar.types.ts`
- Modify: `src/components/Layout/Sidebar/Sidebar.tsx`
- Modify: `src/components/Layout/Sidebar/Sidebar.module.css`

**Step 1: Update Sidebar types**

```typescript
// src/components/Layout/Sidebar/Sidebar.types.ts
export type View = "Board" | "Backlog";

export interface SidebarProps {
  repoId: string;
  currentView: View;
  agentActive: boolean;
  onViewChange: (view: View) => void;
}
```

**Step 2: Update Sidebar component**

Add `RepoSwitcher` below the brand lockup. Import it and add a `repoSection` div:

```typescript
import { RepoSwitcher } from "./RepoSwitcher";
```

Add after the `.logo` div and before `<nav>`:

```tsx
<div className={styles.repoSection}>
  <RepoSwitcher activeRepoId={repoId} />
</div>
```

Pass `repoId` through from `SidebarProps`.

**Step 3: Add CSS for repoSection**

Add to `Sidebar.module.css`:

```css
.repoSection {
  padding: var(--space-3) var(--space-3) 0;
}
```

**Step 4: Run TypeScript check**

Run: `yarn tsc --noEmit`

Expected: zero errors.

**Step 5: Commit**

```bash
git add src/components/Layout/Sidebar/
git commit -m "feat: add RepoSwitcher to Sidebar below brand lockup"
```

---

## Task 12: Final wiring and smoke test

**Files:**
- Check: all components compile
- Check: dev server routes work end-to-end

**Step 1: Full TypeScript check**

Run: `yarn tsc --noEmit`

Expected: zero errors. Fix any remaining type issues before continuing.

**Step 2: Lint**

Run: `yarn lint`

Expected: zero warnings. Fix any import order or unused variable issues.

**Step 3: Dev server smoke test**

Run: `yarn dev`

Check each of the following manually:

1. `http://localhost:3000` → redirects to `/repos/<defaultId>`
2. Board view shows tasks scoped to the active repo
3. Sidebar shows "Claude Code" brand + repo switcher below it
4. Clicking the repo switcher opens dropdown with current repo checked
5. "Add repo" opens the dialog
6. Submitting the dialog with a valid path creates the repo and navigates to its board
7. Submitting with an invalid path shows inline error (no toast, no navigation)
8. Switching repos via the dropdown navigates to the new repo's board
9. Switching repos while a session is open in another tab does not kill the session

**Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix: resolve remaining type and lint issues for multi-repo"
```

---

## Summary

| Task | What it does |
|------|-------------|
| 1 | Add `Repo` type, add `repoId` to `Task` |
| 2 | Server: `repos.json` persistence + startup migration |
| 3 | Server: repos REST endpoints (GET/POST/PATCH/DELETE) |
| 4 | Server: task filtering by repoId, handover uses repo cwd |
| 5 | Client: `useRepos` hook |
| 6 | Client: `useTasks` + `useTasksSocket` scoped by repoId |
| 7 | Client: new routing (`/repos/[repoId]`, `/repos/[repoId]/session/[id]`) |
| 8 | Client: `AppShell` accepts `repoId` prop |
| 9 | Client: `Backlog` + `Board` pass repoId to mutations |
| 10 | Client: `RepoSwitcher` + `AddRepoDialog` components |
| 11 | Client: `Sidebar` gains `RepoSwitcher` below brand lockup |
| 12 | Final TypeScript + lint + smoke test |
