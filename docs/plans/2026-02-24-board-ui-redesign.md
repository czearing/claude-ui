# Board UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a full kanban task board that integrates with the existing Claude PTY session infrastructure, following the provided reference design adapted to CSS Modules + Phosphor Icons + TanStack Query.

**Architecture:** A Next.js app shell with a sidebar (Board/Backlog views), a DnD Kit kanban board (Not Started → In Progress → Review → Done), and a Lexical spec editor. Tasks persist in `tasks.json` via REST endpoints on `server.ts`. "Handover to Claude" spawns a real PTY session linked to the task; when the PTY exits, the task auto-advances to Review.

**Tech Stack:** Next.js 16 App Router, React 19, CSS Modules, TanStack Query v5, DnD Kit v6/v8, Lexical, Radix UI Dialog, Phosphor Icons, TypeScript strict.

---

## Task 1: Install Lexical dependencies

**Files:**

- Modify: `package.json` (via yarn)

**Step 1: Install packages**

```bash
yarn add lexical @lexical/react
```

**Step 2: Verify install**

```bash
yarn why lexical
```

Expected: lexical appears in dependency tree.

**Step 3: Commit**

```bash
git add package.json yarn.lock
git commit -m "feat: add lexical rich text editor dependencies"
```

---

## Task 2: Add QueryClientProvider to layout

**Files:**

- Create: `src/app/Providers.tsx`
- Modify: `src/app/layout.tsx`

**Step 1: Create Providers component**

```tsx
// src/app/Providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

**Step 2: Wrap layout with Providers**

Open `src/app/layout.tsx`. Replace:

```tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
```

With:

```tsx
import { Providers } from "./Providers";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

**Step 3: Verify dev server starts without errors**

```bash
yarn dev
```

Expected: No TypeScript or runtime errors.

**Step 4: Commit**

```bash
git add src/app/Providers.tsx src/app/layout.tsx
git commit -m "feat: add TanStack Query client provider to layout"
```

---

## Task 3: Update global.css — add spacing, radius, typography tokens and shimmer animation

**Files:**

- Modify: `src/app/global.css`

**Step 1: Add tokens and shimmer to the `:root` block and animations section**

Open `src/app/global.css`. After the existing `:root` block (after line 60), add to `:root`:

```css
/* Spacing */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;

/* Border radius */
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 10px;
--radius-xl: 12px;

/* Typography scale */
--text-xs: 11px;
--text-sm: 13px;
--text-base: 14px;
--text-lg: 16px;
--text-xl: 18px;
--text-2xl: 22px;
```

After the `agentPulse` keyframe, add:

```css
@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(200%);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
```

**Step 2: Commit**

```bash
git add src/app/global.css
git commit -m "feat: add spacing, radius, typography tokens and shimmer animation to design system"
```

---

## Task 4: Create task types

**Files:**

- Create: `src/utils/tasks.types.ts`

**Step 1: Write the types file**

```ts
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
  sessionId?: string; // linked Claude PTY session
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export type CreateTaskInput = Pick<Task, "title" | "type" | "priority"> & {
  status?: TaskStatus;
};
export type UpdateTaskInput = Partial<
  Pick<Task, "title" | "type" | "status" | "priority" | "spec" | "sessionId">
>;
```

**Step 2: Commit**

```bash
git add src/utils/tasks.types.ts
git commit -m "feat: add Task type definitions"
```

---

## Task 5: Add task utilities and REST endpoints to server.ts

**Files:**

- Modify: `server.ts`

**Step 1: Read the file first**

Read `server.ts` to understand the current structure. Then apply changes.

**Step 2: Add new imports at the top of server.ts**

After the existing imports, add:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
```

**Step 3: Add task types and utilities after the `sessions` Map declaration**

```ts
// ─── Tasks ────────────────────────────────────────────────────────────────────

const TASKS_FILE = join(process.cwd(), "tasks.json");

type TaskStatus = "Backlog" | "Not Started" | "In Progress" | "Review" | "Done";
type TaskType = "Spec" | "Develop";
type Priority = "Low" | "Medium" | "High" | "Urgent";

interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  spec: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

const boardClients = new Set<WebSocket>();

async function readTasks(): Promise<Task[]> {
  try {
    const raw = await readFile(TASKS_FILE, "utf8");
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
}

async function writeTasks(tasks: Task[]): Promise<void> {
  await writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf8");
}

function broadcastTaskEvent(event: string, data: unknown): void {
  const message = JSON.stringify({ type: event, data });
  boardClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function generateTaskId(tasks: Task[]): string {
  const maxNum = tasks.reduce((max, t) => {
    const num = parseInt(t.id.replace("TASK-", ""), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return `TASK-${String(maxNum + 1).padStart(3, "0")}`;
}

function extractTextFromLexical(specJson: string): string {
  try {
    const state = JSON.parse(specJson) as { root: { children: unknown[] } };
    const texts: string[] = [];
    function walk(node: unknown): void {
      if (typeof node !== "object" || node === null) return;
      const n = node as Record<string, unknown>;
      if (n["type"] === "text" && typeof n["text"] === "string") {
        texts.push(n["text"] as string);
      }
      if (Array.isArray(n["children"])) {
        (n["children"] as unknown[]).forEach(walk);
      }
    }
    walk(state.root);
    return texts.join("\n");
  } catch {
    return specJson;
  }
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += String(chunk)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}") as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
```

**Step 4: Change the HTTP request handler to async and add task endpoints**

Replace the existing `createServer` callback signature:

```ts
const server = createServer((req, res) => {
```

With:

```ts
const server = createServer(async (req, res) => {
  try {
```

And add the task endpoints **before** the existing `DELETE /api/sessions/:id` block:

```ts
const parsedUrl = parse(req.url!, true);

// GET /api/tasks
if (req.method === "GET" && parsedUrl.pathname === "/api/tasks") {
  const tasks = await readTasks();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(tasks));
  return;
}

// POST /api/tasks
if (req.method === "POST" && parsedUrl.pathname === "/api/tasks") {
  const body = await readBody(req);
  const tasks = await readTasks();
  const now = new Date().toISOString();
  const task: Task = {
    id: generateTaskId(tasks),
    title: String(body["title"] ?? ""),
    type: (body["type"] as TaskType) ?? "Spec",
    status: (body["status"] as TaskStatus) ?? "Backlog",
    priority: (body["priority"] as Priority) ?? "Medium",
    spec: String(body["spec"] ?? ""),
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(task);
  await writeTasks(tasks);
  broadcastTaskEvent("task:created", task);
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify(task));
  return;
}

// PATCH /api/tasks/:id
if (
  req.method === "PATCH" &&
  parsedUrl.pathname?.startsWith("/api/tasks/") &&
  !parsedUrl.pathname.endsWith("/handover")
) {
  const id = parsedUrl.pathname.slice("/api/tasks/".length);
  const body = await readBody(req);
  const tasks = await readTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) {
    res.writeHead(404);
    res.end();
    return;
  }
  tasks[idx] = {
    ...tasks[idx]!,
    ...body,
    id,
    updatedAt: new Date().toISOString(),
  } as Task;
  await writeTasks(tasks);
  broadcastTaskEvent("task:updated", tasks[idx]);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(tasks[idx]));
  return;
}

// DELETE /api/tasks/:id
if (req.method === "DELETE" && parsedUrl.pathname?.startsWith("/api/tasks/")) {
  const id = parsedUrl.pathname.slice("/api/tasks/".length);
  const tasks = await readTasks();
  const filtered = tasks.filter((t) => t.id !== id);
  await writeTasks(filtered);
  broadcastTaskEvent("task:deleted", { id });
  res.writeHead(204);
  res.end();
  return;
}
```

Close the try-catch at the end (before `server.listen`):

```ts
  } catch (err) {
    console.error('Request error:', err);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});
```

**Step 5: Verify server starts**

```bash
yarn dev
```

Test endpoints:

```bash
curl http://localhost:3000/api/tasks
# Expected: []

curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test task","type":"Spec","priority":"Medium"}'
# Expected: {"id":"TASK-001","title":"Test task",...}

curl http://localhost:3000/api/tasks
# Expected: [{"id":"TASK-001",...}]
```

**Step 6: Commit**

```bash
git add server.ts
git commit -m "feat: add task REST endpoints (GET, POST, PATCH, DELETE) to server"
```

---

## Task 6: Add handover endpoint and board WebSocket to server.ts

**Files:**

- Modify: `server.ts`

**Step 1: Add handover endpoint after the DELETE /api/tasks/:id block (still inside the try block)**

```ts
// POST /api/tasks/:id/handover
if (req.method === "POST" && parsedUrl.pathname?.endsWith("/handover")) {
  const id = parsedUrl.pathname.slice(
    "/api/tasks/".length,
    -"/handover".length,
  );
  const tasks = await readTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) {
    res.writeHead(404);
    res.end();
    return;
  }
  const task = tasks[idx]!;
  const sessionId = randomUUID();
  const specText = extractTextFromLexical(task.spec);

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
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err) }));
    return;
  }

  const entry: SessionEntry = {
    pty: ptyProcess,
    outputBuffer: [],
    bufferSize: 0,
    activeWs: null,
  };
  sessions.set(sessionId, entry);

  // Send spec as initial prompt after Claude initialises (~2 s)
  if (specText.trim()) {
    setTimeout(() => {
      if (sessions.has(sessionId)) {
        ptyProcess.write(specText + "\n");
      }
    }, 2000);
  }

  ptyProcess.onData((data) => {
    const chunk = Buffer.from(data);
    const e = sessions.get(sessionId);
    if (!e) return;
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

    // Auto-advance to Review
    void readTasks().then((current) => {
      const taskIdx = current.findIndex((t) => t.sessionId === sessionId);
      if (taskIdx !== -1 && current[taskIdx]!.status === "In Progress") {
        current[taskIdx] = {
          ...current[taskIdx]!,
          status: "Review",
          updatedAt: new Date().toISOString(),
        };
        void writeTasks(current).then(() =>
          broadcastTaskEvent("task:updated", current[taskIdx]),
        );
      }
    });
  });

  tasks[idx] = {
    ...task,
    sessionId,
    status: "In Progress",
    updatedAt: new Date().toISOString(),
  };
  await writeTasks(tasks);
  broadcastTaskEvent("task:updated", tasks[idx]);

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(tasks[idx]));
  return;
}
```

**Step 2: Switch WebSocket server to noServer mode and add board WS**

Find and replace the WebSocketServer creation line:

```ts
// OLD:
const wss = new WebSocketServer({ server, path: "/ws/terminal" });
```

```ts
// NEW:
const wss = new WebSocketServer({ noServer: true });
const boardWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = parse(req.url ?? "", true);
  if (url.pathname === "/ws/terminal") {
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } else if (url.pathname === "/ws/board") {
    boardWss.handleUpgrade(req, socket, head, (ws) =>
      boardWss.emit("connection", ws, req),
    );
  } else {
    socket.destroy();
  }
});

boardWss.on("connection", (ws) => {
  boardClients.add(ws);
  ws.on("close", () => boardClients.delete(ws));
});
```

**Step 3: Verify handover works**

```bash
yarn dev
```

```bash
# First create a task
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"Test handover","type":"Spec","priority":"Medium"}'

# Then handover (replace TASK-001 with actual id)
curl -X POST http://localhost:3000/api/tasks/TASK-001/handover
# Expected: task with status:"In Progress" and sessionId set
```

**Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: add task handover endpoint and board WebSocket broadcast"
```

---

## Task 7: Create useTasks hooks

**Files:**

- Create: `src/hooks/useTasks.ts`

**Step 1: Write the hooks file**

```ts
// src/hooks/useTasks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateTaskInput,
  Task,
  UpdateTaskInput,
} from "@/utils/tasks.types";

const TASKS_KEY = ["tasks"] as const;

async function fetchTasks(): Promise<Task[]> {
  const res = await fetch("/api/tasks");
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json() as Promise<Task[]>;
}

export function useTasks() {
  return useQuery({ queryKey: TASKS_KEY, queryFn: fetchTasks });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).then((r) => r.json()) as Promise<Task>,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) =>
      fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).then((r) => r.json()) as Promise<Task>,
    onMutate: async ({ id, ...input }) => {
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const previous = queryClient.getQueryData<Task[]>(TASKS_KEY);
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) =>
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
        queryClient.setQueryData(TASKS_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetch(`/api/tasks/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: TASKS_KEY });
      const previous = queryClient.getQueryData<Task[]>(TASKS_KEY);
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(TASKS_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useHandoverTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/tasks/${id}/handover`, { method: "POST" }).then((r) =>
        r.json(),
      ) as Promise<Task>,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}
```

**Step 2: Commit**

```bash
git add src/hooks/useTasks.ts
git commit -m "feat: add TanStack Query hooks for tasks CRUD and handover"
```

---

## Task 8: Create useTasksSocket hook

**Files:**

- Create: `src/hooks/useTasksSocket.ts`

**Step 1: Write the hook**

```ts
// src/hooks/useTasksSocket.ts
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

const TASK_EVENTS = new Set(["task:created", "task:updated", "task:deleted"]);

export function useTasksSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/board`);

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string };
        if (TASK_EVENTS.has(msg.type)) {
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    return () => ws.close();
  }, [queryClient]);
}
```

**Step 2: Commit**

```bash
git add src/hooks/useTasksSocket.ts
git commit -m "feat: add useTasksSocket hook for live task board updates"
```

---

## Task 9: Create Layout/Sidebar component

**Files:**

- Create: `src/components/Layout/Sidebar/index.ts`
- Create: `src/components/Layout/Sidebar/Sidebar.tsx`
- Create: `src/components/Layout/Sidebar/Sidebar.module.css`
- Create: `src/components/Layout/Sidebar/Sidebar.types.ts`

**Step 1: Write types**

```ts
// src/components/Layout/Sidebar/Sidebar.types.ts
export type View = "Board" | "Backlog";

export interface SidebarProps {
  currentView: View;
  agentActive: boolean;
  onViewChange: (view: View) => void;
}
```

**Step 2: Write CSS module**

```css
/* src/components/Layout/Sidebar/Sidebar.module.css */
.sidebar {
  width: 256px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  background-color: var(--color-surface);
  display: flex;
  flex-direction: column;
  height: 100%;
}

.logo {
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.logoIcon {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background-color: var(--color-agent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.logoText {
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.nav {
  flex: 1;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.navItem {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  border: none;
  cursor: pointer;
  transition:
    background-color 150ms,
    color 150ms;
  text-align: left;
  background: transparent;
}

.navItemActive {
  background-color: var(--color-border);
  color: var(--color-text);
}

.navItemInactive {
  color: var(--color-text-muted);
}

.navItemInactive:hover {
  background-color: var(--color-border);
  color: var(--color-text);
}

.footer {
  padding: var(--space-4);
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.agentStatus {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.agentLabel {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.agentIndicator {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.agentIndicatorText {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dotActive {
  background-color: var(--color-agent);
  animation: pulse 2s infinite;
}

.dotIdle {
  background-color: #6b7280;
}
```

**Step 3: Write component**

```tsx
// src/components/Layout/Sidebar/Sidebar.tsx
import {
  Activity,
  Archive,
  CheckSquare,
  Gear,
  SquaresFour,
} from "@phosphor-icons/react";
import clsx from "clsx";

import type { SidebarProps, View } from "./Sidebar.types";
import styles from "./Sidebar.module.css";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        styles.navItem,
        active ? styles.navItemActive : styles.navItemInactive,
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

const NAV_VIEWS: { view: View; label: string; icon: React.ReactNode }[] = [
  { view: "Board", label: "Board", icon: <SquaresFour size={16} /> },
  { view: "Backlog", label: "Backlog", icon: <CheckSquare size={16} /> },
];

export function Sidebar({
  currentView,
  agentActive,
  onViewChange,
}: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <Activity size={14} color="white" weight="bold" />
        </div>
        <span className={styles.logoText}>Claude Code</span>
      </div>

      <nav className={styles.nav}>
        {NAV_VIEWS.map(({ view, label, icon }) => (
          <NavItem
            key={view}
            icon={icon}
            label={label}
            active={currentView === view}
            onClick={() => onViewChange(view)}
          />
        ))}
        <NavItem icon={<Archive size={16} />} label="Archives" />
      </nav>

      <div className={styles.footer}>
        <div className={styles.agentStatus}>
          <span className={styles.agentLabel}>Agent Status</span>
          <div className={styles.agentIndicator}>
            <span className={styles.agentIndicatorText}>
              {agentActive ? "Active" : "Idle"}
            </span>
            <div
              className={clsx(
                styles.dot,
                agentActive ? styles.dotActive : styles.dotIdle,
              )}
            />
          </div>
        </div>
        <NavItem icon={<Gear size={16} />} label="Settings" />
      </div>
    </aside>
  );
}
```

**Step 4: Write barrel**

```ts
// src/components/Layout/Sidebar/index.ts
export { Sidebar } from "./Sidebar";
export type { SidebarProps, View } from "./Sidebar.types";
```

**Step 5: Commit**

```bash
git add src/components/Layout/
git commit -m "feat: add Sidebar layout component"
```

---

## Task 10: Create Layout/TopBar component

**Files:**

- Create: `src/components/Layout/TopBar/index.ts`
- Create: `src/components/Layout/TopBar/TopBar.tsx`
- Create: `src/components/Layout/TopBar/TopBar.module.css`
- Create: `src/components/Layout/TopBar/TopBar.types.ts`

**Step 1: Write types**

```ts
// src/components/Layout/TopBar/TopBar.types.ts
import type { View } from "../Sidebar/Sidebar.types";

export interface TopBarProps {
  currentView: View;
  onNewIssue: () => void;
}
```

**Step 2: Write CSS**

```css
/* src/components/Layout/TopBar/TopBar.module.css */
.topBar {
  height: 56px;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-4);
  flex-shrink: 0;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.breadcrumbCurrent {
  color: var(--color-text);
  font-weight: 500;
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.searchWrapper {
  position: relative;
}

.searchIcon {
  position: absolute;
  left: var(--space-3);
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  pointer-events: none;
}

.searchInput {
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 6px var(--space-3) 6px 32px;
  font-size: var(--text-sm);
  color: var(--color-text);
  width: 256px;
  transition: border-color 150ms;
  outline: none;
}

.searchInput:focus {
  border-color: var(--color-agent);
}

.searchInput::placeholder {
  color: var(--color-text-muted);
}

.iconButton {
  padding: 6px;
  color: var(--color-text-muted);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 150ms,
    color 150ms;
}

.iconButton:hover {
  background-color: var(--color-border);
  color: var(--color-text);
}

.divider {
  width: 1px;
  height: 16px;
  background-color: var(--color-border);
}

.newIssueButton {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background-color: var(--color-agent);
  color: white;
  border: none;
  padding: 6px var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: opacity 150ms;
}

.newIssueButton:hover {
  opacity: 0.9;
}
```

**Step 3: Write component**

```tsx
// src/components/Layout/TopBar/TopBar.tsx
import { Funnel, MagnifyingGlass, Plus, Rows } from "@phosphor-icons/react";

import type { TopBarProps } from "./TopBar.types";
import styles from "./TopBar.module.css";

export function TopBar({ currentView, onNewIssue }: TopBarProps) {
  return (
    <header className={styles.topBar}>
      <div className={styles.breadcrumb}>
        <span>Claude Code</span>
        <span>/</span>
        <span className={styles.breadcrumbCurrent}>{currentView}</span>
      </div>

      <div className={styles.actions}>
        <div className={styles.searchWrapper}>
          <MagnifyingGlass size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search..."
            className={styles.searchInput}
          />
        </div>

        <button className={styles.iconButton} aria-label="Filter">
          <Funnel size={16} />
        </button>
        <button className={styles.iconButton} aria-label="View options">
          <Rows size={16} />
        </button>

        <div className={styles.divider} />

        <button className={styles.newIssueButton} onClick={onNewIssue}>
          <Plus size={16} weight="bold" />
          <span>New Issue</span>
        </button>
      </div>
    </header>
  );
}
```

**Step 4: Write barrel**

```ts
// src/components/Layout/TopBar/index.ts
export { TopBar } from "./TopBar";
export type { TopBarProps } from "./TopBar.types";
```

**Step 5: Commit**

```bash
git add src/components/Layout/TopBar/
git commit -m "feat: add TopBar layout component"
```

---

## Task 11: Create Board/Column component

**Files:**

- Create: `src/components/Board/Column/index.ts`
- Create: `src/components/Board/Column/Column.tsx`
- Create: `src/components/Board/Column/Column.module.css`
- Create: `src/components/Board/Column/Column.types.ts`

**Step 1: Write types**

```ts
// src/components/Board/Column/Column.types.ts
import type { Task, TaskStatus } from "@/utils/tasks.types";

export interface ColumnProps {
  status: TaskStatus;
  tasks: Task[];
}
```

**Step 2: Write CSS**

```css
/* src/components/Board/Column/Column.module.css */
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

.headerLeft {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.statusDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dotGray {
  background-color: #6b7280;
}
.dotLight {
  background-color: #d1d5db;
}
.dotAgent {
  background-color: var(--color-agent);
}
.dotOrange {
  background-color: #f97316;
}
.dotGreen {
  background-color: #22c55e;
}

.statusTitle {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text);
}

.badge {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.dropZone {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  border-radius: var(--radius-xl);
  padding: var(--space-2);
  transition: background-color 200ms;
  min-height: 80px;
}

.dropZoneOver {
  background-color: var(--color-agent-light);
}
```

**Step 3: Write component**

```tsx
// src/components/Board/Column/Column.tsx
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import clsx from "clsx";

import type { TaskStatus } from "@/utils/tasks.types";
import { TaskCard } from "../TaskCard";
import type { ColumnProps } from "./Column.types";
import styles from "./Column.module.css";

const DOT_CLASS: Record<TaskStatus, string> = {
  Backlog: styles.dotGray,
  "Not Started": styles.dotLight,
  "In Progress": styles.dotAgent,
  Review: styles.dotOrange,
  Done: styles.dotGreen,
};

export function Column({ status, tasks }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className={styles.column}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={clsx(styles.statusDot, DOT_CLASS[status])} />
          <h3 className={styles.statusTitle}>{status}</h3>
          <span className={styles.badge}>{tasks.length}</span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={clsx(styles.dropZone, isOver && styles.dropZoneOver)}
      >
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
```

**Step 4: Write barrel**

```ts
// src/components/Board/Column/index.ts
export { Column } from "./Column";
export type { ColumnProps } from "./Column.types";
```

**Step 5: Commit**

```bash
git add src/components/Board/Column/
git commit -m "feat: add Board Column component with DnD droppable"
```

---

## Task 12: Create Board/TaskCard component

**Files:**

- Create: `src/components/Board/TaskCard/index.ts`
- Create: `src/components/Board/TaskCard/TaskCard.tsx`
- Create: `src/components/Board/TaskCard/TaskCard.module.css`
- Create: `src/components/Board/TaskCard/TaskCard.types.ts`

**Step 1: Write types**

```ts
// src/components/Board/TaskCard/TaskCard.types.ts
import type { Task } from "@/utils/tasks.types";

export interface TaskCardProps {
  task: Task;
  onSelect: (task: Task) => void;
}
```

**Step 2: Write CSS**

```css
/* src/components/Board/TaskCard/TaskCard.module.css */
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  border: 1px solid var(--color-border);
  background-color: var(--color-surface);
  cursor: grab;
  transition:
    border-color 150ms,
    opacity 150ms,
    transform 150ms,
    box-shadow 150ms;
}

.card:active {
  cursor: grabbing;
}

.card:hover {
  border-color: #4b5563;
}

.cardDragging {
  opacity: 0.5;
  transform: scale(1.03);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  z-index: 50;
}

.cardAgentActive {
  animation: agentPulse 2s infinite;
}

.cardDone {
  opacity: 0.5;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}

.titleRow {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}

.typeIcon {
  color: var(--color-text-muted);
  margin-top: 1px;
  flex-shrink: 0;
}

.title {
  font-size: var(--text-sm);
  font-weight: 500;
  line-height: 1.4;
  color: var(--color-text);
}

.titleDone {
  text-decoration: line-through;
  color: var(--color-text-muted);
}

.reviewBadge {
  flex-shrink: 0;
  background-color: rgba(249, 115, 22, 0.2);
  color: #fb923c;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.agentBadge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--color-agent);
  font-weight: 500;
  background-color: var(--color-agent-light);
  width: fit-content;
  padding: 4px var(--space-2);
  border-radius: var(--radius-md);
  overflow: hidden;
  position: relative;
}

.shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.1),
    transparent
  );
  animation: shimmer 2s infinite;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-1);
}

.meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.taskId {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--color-text-muted);
}

.priorityLow {
  color: #9ca3af;
}
.priorityMedium {
  color: #60a5fa;
}
.priorityHigh {
  color: #fb923c;
}
.priorityUrgent {
  color: #ef4444;
}

.avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
}

.sessionLink {
  font-size: var(--text-xs);
  color: var(--color-agent);
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0.8;
  transition: opacity 150ms;
}

.sessionLink:hover {
  opacity: 1;
  text-decoration: underline;
}
```

**Step 3: Write component**

```tsx
// src/components/Board/TaskCard/TaskCard.tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Activity,
  ArrowRight,
  Code,
  FileText,
  User,
  Warning,
} from "@phosphor-icons/react";
import clsx from "clsx";

import type { Priority, Task } from "@/utils/tasks.types";
import type { TaskCardProps } from "./TaskCard.types";
import styles from "./TaskCard.module.css";

const PRIORITY_CLASS: Record<Priority, string> = {
  Low: styles.priorityLow,
  Medium: styles.priorityMedium,
  High: styles.priorityHigh,
  Urgent: styles.priorityUrgent,
};

export function TaskCard({ task, onSelect }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const isAgentActive = task.status === "In Progress";
  const isReview = task.status === "Review";
  const isDone = task.status === "Done";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(task)}
      className={clsx(
        styles.card,
        isDragging && styles.cardDragging,
        isAgentActive && styles.cardAgentActive,
        isDone && styles.cardDone,
      )}
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          {task.type === "Spec" ? (
            <FileText size={16} className={styles.typeIcon} />
          ) : (
            <Code size={16} className={styles.typeIcon} />
          )}
          <span className={clsx(styles.title, isDone && styles.titleDone)}>
            {task.title}
          </span>
        </div>
        {isReview && <span className={styles.reviewBadge}>Review</span>}
      </div>

      {isAgentActive && (
        <div className={styles.agentBadge}>
          <div className={styles.shimmer} />
          <Activity size={12} />
          <span>Agent Processing...</span>
        </div>
      )}

      <div className={styles.footer}>
        <div className={styles.meta}>
          <span className={styles.taskId}>{task.id}</span>
          <Warning size={14} className={PRIORITY_CLASS[task.priority]} />
        </div>

        {task.sessionId ? (
          <a
            href={`/session/${task.sessionId}`}
            className={styles.sessionLink}
            onClick={(e) => e.stopPropagation()}
          >
            <span>Terminal</span>
            <ArrowRight size={10} />
          </a>
        ) : (
          <div className={styles.avatar}>
            <User size={12} color="var(--color-text-muted)" />
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 4: Write barrel**

```ts
// src/components/Board/TaskCard/index.ts
export { TaskCard } from "./TaskCard";
export type { TaskCardProps } from "./TaskCard.types";
```

**Step 5: Commit**

```bash
git add src/components/Board/TaskCard/
git commit -m "feat: add TaskCard component with agent pulse and session link"
```

---

## Task 13: Create Board/Board component

**Files:**

- Create: `src/components/Board/Board/index.ts`
- Create: `src/components/Board/Board/Board.tsx`
- Create: `src/components/Board/Board/Board.module.css`

**Step 1: Write CSS**

```css
/* src/components/Board/Board/Board.module.css */
.board {
  flex: 1;
  overflow-x: auto;
  padding: var(--space-6);
  background-color: var(--color-bg);
  height: 100%;
}

.columns {
  display: flex;
  gap: var(--space-6);
  height: 100%;
  align-items: flex-start;
  min-width: max-content;
}
```

**Step 2: Write component**

```tsx
// src/components/Board/Board/Board.tsx
"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useState } from "react";

import { useUpdateTask } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import type { Task, TaskStatus } from "@/utils/tasks.types";
import { Column } from "../Column";
import { TaskCard } from "../TaskCard";
import styles from "./Board.module.css";

const BOARD_COLUMNS: TaskStatus[] = [
  "Not Started",
  "In Progress",
  "Review",
  "Done",
];

interface BoardProps {
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}

export function Board({ tasks, onSelectTask }: BoardProps) {
  useTasksSocket();

  const { mutate: updateTask } = useUpdateTask();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveTask(tasks.find((t) => t.id === active.id) ?? null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTask(null);
    if (!over) return;

    const overId = over.id as string;
    const targetStatus = BOARD_COLUMNS.includes(overId as TaskStatus)
      ? (overId as TaskStatus)
      : (tasks.find((t) => t.id === overId)?.status ?? null);

    if (targetStatus && active.id !== over.id) {
      updateTask({ id: active.id as string, status: targetStatus });
    }
  };

  return (
    <div className={styles.board}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className={styles.columns}>
          {BOARD_COLUMNS.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={tasks.filter((t) => t.status === status)}
              onSelectTask={onSelectTask}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <TaskCard task={activeTask} onSelect={() => undefined} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
```

**Note:** Column needs to forward `onSelectTask` to TaskCard. Update `Column.types.ts` to add `onSelectTask: (task: Task) => void` and pass it through.

**Step 3: Write barrel**

```ts
// src/components/Board/Board/index.ts
export { Board } from "./Board";
```

**Step 4: Update Column to forward onSelectTask**

In `Column.types.ts` add:

```ts
import type { Task, TaskStatus } from "@/utils/tasks.types";

export interface ColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}
```

In `Column.tsx`, pass `onSelectTask` to each `TaskCard`:

```tsx
{
  tasks.map((task) => (
    <TaskCard key={task.id} task={task} onSelect={onSelectTask} />
  ));
}
```

**Step 5: Commit**

```bash
git add src/components/Board/Board/ src/components/Board/Column/
git commit -m "feat: add Board component with DnD context and column layout"
```

---

## Task 14: Create Board/Backlog component

**Files:**

- Create: `src/components/Board/Backlog/index.ts`
- Create: `src/components/Board/Backlog/Backlog.tsx`
- Create: `src/components/Board/Backlog/Backlog.module.css`

**Step 1: Write CSS**

```css
/* src/components/Board/Backlog/Backlog.module.css */
.backlog {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-8);
  background-color: var(--color-bg);
  height: 100%;
}

.inner {
  max-width: 768px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.headerRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.heading {
  font-size: var(--text-2xl);
  font-weight: 600;
}

.count {
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  color: var(--color-text-muted);
  background-color: var(--color-surface);
  padding: 4px var(--space-2);
  border-radius: var(--radius-sm);
}

.createForm {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  transition: border-color 150ms;
}

.createForm:focus-within {
  border-color: var(--color-agent);
}

.createInput {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.createInput::placeholder {
  color: var(--color-text-muted);
}

.typeToggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background-color: var(--color-bg);
  border-radius: var(--radius-md);
  padding: 4px;
  border: 1px solid var(--color-border);
}

.typeButton {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px var(--space-2);
  font-size: var(--text-xs);
  font-weight: 500;
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  background: transparent;
  transition:
    background-color 150ms,
    color 150ms;
  color: var(--color-text-muted);
}

.typeButton:hover {
  color: var(--color-text);
}

.typeButtonActive {
  background-color: var(--color-surface);
  color: var(--color-text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.addButton {
  background-color: var(--color-agent);
  color: white;
  border: none;
  padding: 6px var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: opacity 150ms;
}

.addButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.emptyState {
  text-align: center;
  padding: 48px var(--space-4);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
}
```

**Step 2: Write component**

```tsx
// src/components/Board/Backlog/Backlog.tsx
"use client";

import { Code, FileText, Plus } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";

import { useCreateTask, useTasks } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import type { Task, TaskType } from "@/utils/tasks.types";
import { TaskCard } from "../TaskCard";
import styles from "./Backlog.module.css";

interface BacklogProps {
  onSelectTask: (task: Task) => void;
}

export function Backlog({ onSelectTask }: BacklogProps) {
  useTasksSocket();

  const { data: allTasks = [] } = useTasks();
  const { mutate: createTask } = useCreateTask();
  const backlogTasks = allTasks.filter((t) => t.status === "Backlog");

  const [draftTitle, setDraftTitle] = useState("");
  const [draftType, setDraftType] = useState<TaskType>("Spec");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftTitle.trim()) return;
    createTask({
      title: draftTitle.trim(),
      type: draftType,
      priority: "Medium",
      status: "Backlog",
    });
    setDraftTitle("");
  };

  return (
    <div className={styles.backlog}>
      <div className={styles.inner}>
        <div className={styles.headerRow}>
          <h1 className={styles.heading}>Backlog</h1>
          <span className={styles.count}>{backlogTasks.length} issues</span>
        </div>

        <form onSubmit={handleSubmit} className={styles.createForm}>
          <Plus size={20} color="var(--color-text-muted)" />
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Create a new draft..."
            className={styles.createInput}
          />
          <div className={styles.typeToggle}>
            {(["Spec", "Develop"] as TaskType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDraftType(t)}
                className={clsx(
                  styles.typeButton,
                  draftType === t && styles.typeButtonActive,
                )}
              >
                {t === "Spec" ? <FileText size={12} /> : <Code size={12} />}
                {t}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={!draftTitle.trim()}
            className={styles.addButton}
          >
            Add
          </button>
        </form>

        <div className={styles.list}>
          {backlogTasks.map((task) => (
            <TaskCard key={task.id} task={task} onSelect={onSelectTask} />
          ))}
          {backlogTasks.length === 0 && (
            <div className={styles.emptyState}>
              No issues in the backlog. Create a draft above to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Write barrel**

```ts
// src/components/Board/Backlog/index.ts
export { Backlog } from "./Backlog";
```

**Step 4: Commit**

```bash
git add src/components/Board/Backlog/
git commit -m "feat: add Backlog view component with inline task creation"
```

---

## Task 15: Create Editor/LexicalEditor component

**Files:**

- Create: `src/components/Editor/LexicalEditor/index.ts`
- Create: `src/components/Editor/LexicalEditor/LexicalEditor.tsx`
- Create: `src/components/Editor/LexicalEditor/LexicalEditor.module.css`
- Create: `src/components/Editor/LexicalEditor/LexicalEditor.types.ts`

**Step 1: Write types**

```ts
// src/components/Editor/LexicalEditor/LexicalEditor.types.ts
export interface LexicalEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}
```

**Step 2: Write CSS**

```css
/* src/components/Editor/LexicalEditor/LexicalEditor.module.css */
.wrapper {
  position: relative;
}

.editorContent {
  outline: none;
  min-height: 200px;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--color-text);
}

.placeholder {
  position: absolute;
  top: 0;
  left: 0;
  color: var(--color-text-muted);
  pointer-events: none;
  font-size: var(--text-sm);
  line-height: 1.6;
}
```

**Step 3: Write component**

```tsx
// src/components/Editor/LexicalEditor/LexicalEditor.tsx
"use client";

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import type { EditorState } from "lexical";
import { useEffect } from "react";

import type { LexicalEditorProps } from "./LexicalEditor.types";
import styles from "./LexicalEditor.module.css";

const THEME = {
  paragraph: "",
  text: { bold: "font-bold", italic: "italic", underline: "underline" },
};

function StateLoader({ value }: { value?: string }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!value) return;
    try {
      const state = editor.parseEditorState(value);
      editor.setEditorState(state);
    } catch {
      // ignore invalid state
    }
  }, [editor, value]);
  return null;
}

export function LexicalEditor({
  value,
  onChange,
  readOnly = false,
}: LexicalEditorProps) {
  const initialConfig = {
    namespace: "SpecEditor",
    theme: THEME,
    editable: !readOnly,
    onError: (error: Error) => console.error(error),
  };

  const handleChange = (editorState: EditorState) => {
    onChange?.(JSON.stringify(editorState.toJSON()));
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={styles.wrapper}>
        <RichTextPlugin
          contentEditable={<ContentEditable className={styles.editorContent} />}
          placeholder={
            <div className={styles.placeholder}>Enter spec details...</div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        {onChange && <OnChangePlugin onChange={handleChange} />}
        <StateLoader value={value} />
      </div>
    </LexicalComposer>
  );
}
```

**Step 4: Write barrel**

```ts
// src/components/Editor/LexicalEditor/index.ts
export { LexicalEditor } from "./LexicalEditor";
export type { LexicalEditorProps } from "./LexicalEditor.types";
```

**Step 5: Commit**

```bash
git add src/components/Editor/LexicalEditor/
git commit -m "feat: add LexicalEditor rich text component"
```

---

## Task 16: Create Editor/SpecEditor component

**Files:**

- Create: `src/components/Editor/SpecEditor/index.ts`
- Create: `src/components/Editor/SpecEditor/SpecEditor.tsx`
- Create: `src/components/Editor/SpecEditor/SpecEditor.module.css`
- Create: `src/components/Editor/SpecEditor/SpecEditor.types.ts`

**Step 1: Write types**

```ts
// src/components/Editor/SpecEditor/SpecEditor.types.ts
import type { Task } from "@/utils/tasks.types";

export interface SpecEditorProps {
  task: Task | null;
  onClose: () => void;
}
```

**Step 2: Write CSS**

```css
/* src/components/Editor/SpecEditor/SpecEditor.module.css */
.panel {
  position: fixed;
  inset-block: 0;
  right: 0;
  width: 600px;
  background: rgba(30, 30, 33, 0.7);
  backdrop-filter: blur(12px);
  border-left: 1px solid var(--color-border);
  box-shadow: -20px 0 60px rgba(0, 0, 0, 0.4);
  z-index: 50;
  display: flex;
  flex-direction: column;
}

.panelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.panelTitle {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.taskId {
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  color: var(--color-text-muted);
}

.taskTitle {
  font-size: var(--text-lg);
  font-weight: 600;
}

.closeButton {
  padding: 6px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 150ms,
    color 150ms;
}

.closeButton:hover {
  background-color: var(--color-border);
  color: var(--color-text);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.statusRow {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.statusItem {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.dotAgent {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-agent);
}
.dotOrange {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #f97316;
}

.editorWrapper {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg);
  min-height: 240px;
}

.editorToolbar {
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--color-surface);
  flex-shrink: 0;
}

.editorLabel {
  font-size: var(--text-sm);
  font-weight: 500;
}

.editToggle {
  font-size: var(--text-xs);
  color: var(--color-agent);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: text-decoration 150ms;
}

.editToggle:hover {
  text-decoration: underline;
}

.editorBody {
  flex: 1;
  padding: var(--space-4);
  overflow-y: auto;
}

.agentNotes {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.agentNotesTitle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-agent);
  font-weight: 500;
  font-size: var(--text-sm);
}

.agentNotesText {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.viewDiffButton {
  background-color: var(--color-border);
  color: var(--color-text);
  border: none;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  width: fit-content;
  transition: background-color 150ms;
}

.viewDiffButton:hover {
  background-color: #3f3f46;
}

.footer {
  padding: var(--space-4);
  border-top: 1px solid var(--color-border);
  background-color: var(--color-surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.footerMeta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.footerActions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.saveDraftButton {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  background: transparent;
  border: none;
  color: var(--color-text);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 150ms;
}

.saveDraftButton:hover {
  background-color: var(--color-border);
}

.handoverButton {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background-color: var(--color-agent);
  color: white;
  border: none;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: opacity 150ms;
}

.handoverButton:hover {
  opacity: 0.9;
}

.handoverButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**Step 3: Write component**

```tsx
// src/components/Editor/SpecEditor/SpecEditor.tsx
"use client";

import { PaperPlaneTilt, Robot, User, X } from "@phosphor-icons/react";
import { useState } from "react";

import { useHandoverTask, useUpdateTask } from "@/hooks/useTasks";
import { LexicalEditor } from "../LexicalEditor";
import type { SpecEditorProps } from "./SpecEditor.types";
import styles from "./SpecEditor.module.css";

export function SpecEditor({ task, onClose }: SpecEditorProps) {
  const { mutate: updateTask } = useUpdateTask();
  const { mutate: handoverTask, isPending: isHandingOver } = useHandoverTask();

  const [spec, setSpec] = useState(task?.spec ?? "");
  const [isEditing, setIsEditing] = useState(!task?.spec);

  if (!task) return null;

  const isBacklog = task.status === "Backlog";
  const isReview = task.status === "Review";

  const handleSave = () => {
    updateTask({ id: task.id, spec });
    setIsEditing(false);
  };

  const handleHandover = () => {
    updateTask({ id: task.id, spec });
    handoverTask(task.id, { onSuccess: onClose });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <span className={styles.taskId}>{task.id}</span>
          <h2 className={styles.taskTitle}>{task.title}</h2>
        </div>
        <button
          className={styles.closeButton}
          onClick={onClose}
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.statusRow}>
          <div className={styles.statusItem}>
            <div className={styles.dotAgent} />
            <span>Status: {task.status}</span>
          </div>
          <div className={styles.statusItem}>
            <div className={styles.dotOrange} />
            <span>Priority: {task.priority}</span>
          </div>
        </div>

        <div className={styles.editorWrapper}>
          <div className={styles.editorToolbar}>
            <span className={styles.editorLabel}>Specification</span>
            {isBacklog && (
              <button
                className={styles.editToggle}
                onClick={() => setIsEditing((v) => !v)}
              >
                {isEditing ? "Preview" : "Edit"}
              </button>
            )}
          </div>
          <div className={styles.editorBody}>
            <LexicalEditor
              key={`${task.id}-${isEditing ? "edit" : "read"}`}
              value={spec}
              onChange={isEditing ? setSpec : undefined}
              readOnly={!isEditing}
            />
          </div>
        </div>

        {isReview && (
          <div className={styles.agentNotes}>
            <div className={styles.agentNotesTitle}>
              <Robot size={16} />
              <span>Agent Notes</span>
            </div>
            <p className={styles.agentNotesText}>
              Implementation complete according to the spec. Please review the
              changes in the terminal.
            </p>
            {task.sessionId && (
              <a
                href={`/session/${task.sessionId}`}
                className={styles.viewDiffButton}
                style={{ textDecoration: "none", display: "inline-block" }}
              >
                Open Terminal
              </a>
            )}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <div className={styles.footerMeta}>
          <User size={16} />
          <span>You are editing</span>
        </div>
        <div className={styles.footerActions}>
          {isEditing && isBacklog && (
            <button className={styles.saveDraftButton} onClick={handleSave}>
              Save Draft
            </button>
          )}
          {isBacklog && (
            <button
              className={styles.handoverButton}
              onClick={handleHandover}
              disabled={isHandingOver}
            >
              <PaperPlaneTilt size={16} />
              <span>
                {isHandingOver ? "Starting..." : "Handover to Claude"}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Write barrel**

```ts
// src/components/Editor/SpecEditor/index.ts
export { SpecEditor } from "./SpecEditor";
export type { SpecEditorProps } from "./SpecEditor.types";
```

**Step 5: Commit**

```bash
git add src/components/Editor/
git commit -m "feat: add SpecEditor slide-in panel with Lexical editor and handover"
```

---

## Task 17: Create Modals/NewIssueModal component

**Files:**

- Create: `src/components/Modals/NewIssueModal/index.ts`
- Create: `src/components/Modals/NewIssueModal/NewIssueModal.tsx`
- Create: `src/components/Modals/NewIssueModal/NewIssueModal.module.css`
- Create: `src/components/Modals/NewIssueModal/NewIssueModal.types.ts`

**Step 1: Write types**

```ts
// src/components/Modals/NewIssueModal/NewIssueModal.types.ts
export interface NewIssueModalProps {
  open: boolean;
  onClose: () => void;
}
```

**Step 2: Write CSS**

```css
/* src/components/Modals/NewIssueModal/NewIssueModal.module.css */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
}

.modal {
  background-color: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  width: 100%;
  max-width: 480px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.title {
  font-size: var(--text-lg);
  font-weight: 600;
}

.closeButton {
  padding: 6px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color 150ms,
    color 150ms;
}

.closeButton:hover {
  background-color: var(--color-border);
  color: var(--color-text);
}

.form {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-muted);
}

.input {
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text);
  outline: none;
  transition: border-color 150ms;
}

.input:focus {
  border-color: var(--color-agent);
}

.input::placeholder {
  color: var(--color-text-muted);
}

.row {
  display: flex;
  gap: var(--space-4);
}

.typeToggle {
  display: flex;
  align-items: center;
  gap: 4px;
  background-color: var(--color-bg);
  border-radius: var(--radius-md);
  padding: 4px;
  border: 1px solid var(--color-border);
}

.typeButton {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px var(--space-2);
  font-size: var(--text-xs);
  font-weight: 500;
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  background: transparent;
  transition:
    background-color 150ms,
    color 150ms;
  color: var(--color-text-muted);
}

.typeButton:hover {
  color: var(--color-text);
}

.typeButtonActive {
  background-color: var(--color-surface);
  color: var(--color-text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
}

.select {
  background-color: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--color-text);
  outline: none;
  transition: border-color 150ms;
  appearance: none;
  width: 100%;
}

.select:focus {
  border-color: var(--color-agent);
}

.formFooter {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.cancelButton {
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  font-weight: 500;
  background: transparent;
  border: none;
  color: var(--color-text);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color 150ms;
}

.cancelButton:hover {
  background-color: var(--color-border);
}

.submitButton {
  background-color: var(--color-agent);
  color: white;
  border: none;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: opacity 150ms;
}

.submitButton:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

**Step 3: Write component**

```tsx
// src/components/Modals/NewIssueModal/NewIssueModal.tsx
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Code, FileText, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";

import { useCreateTask } from "@/hooks/useTasks";
import type { Priority, TaskType } from "@/utils/tasks.types";
import type { NewIssueModalProps } from "./NewIssueModal.types";
import styles from "./NewIssueModal.module.css";

export function NewIssueModal({ open, onClose }: NewIssueModalProps) {
  const { mutate: createTask } = useCreateTask();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("Spec");
  const [priority, setPriority] = useState<Priority>("Medium");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createTask(
      { title: title.trim(), type, priority, status: "Backlog" },
      {
        onSuccess: () => {
          setTitle("");
          setType("Spec");
          setPriority("Medium");
          onClose();
        },
      },
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay}>
          <Dialog.Content className={styles.modal}>
            <div className={styles.header}>
              <Dialog.Title className={styles.title}>New Issue</Dialog.Title>
              <Dialog.Close asChild>
                <button className={styles.closeButton} aria-label="Close">
                  <X size={20} />
                </button>
              </Dialog.Close>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>Title</label>
                <input
                  autoFocus
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  className={styles.input}
                />
              </div>

              <div className={styles.row}>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={styles.label}>Type</label>
                  <div className={styles.typeToggle}>
                    {(["Spec", "Develop"] as TaskType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={clsx(
                          styles.typeButton,
                          type === t && styles.typeButtonActive,
                        )}
                      >
                        {t === "Spec" ? (
                          <FileText size={14} />
                        ) : (
                          <Code size={14} />
                        )}
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={styles.label}>Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Priority)}
                    className={styles.select}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className={styles.formFooter}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className={styles.submitButton}
                >
                  Create Issue
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

**Step 4: Write barrel**

```ts
// src/components/Modals/NewIssueModal/index.ts
export { NewIssueModal } from "./NewIssueModal";
export type { NewIssueModalProps } from "./NewIssueModal.types";
```

**Step 5: Commit**

```bash
git add src/components/Modals/
git commit -m "feat: add NewIssueModal with Radix Dialog"
```

---

## Task 18: Create AppShell and wire everything together

**Files:**

- Create: `src/app/AppShell.tsx`
- Create: `src/app/AppShell.module.css`
- Modify: `src/app/page.tsx`

**Step 1: Write CSS**

```css
/* src/app/AppShell.module.css */
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
  position: relative;
}

.content {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  z-index: 40;
}
```

**Step 2: Write AppShell**

```tsx
// src/app/AppShell.tsx
"use client";

import { useState } from "react";

import { Backlog } from "@/components/Board/Backlog";
import { Board } from "@/components/Board/Board";
import { SpecEditor } from "@/components/Editor/SpecEditor";
import { Sidebar, type View } from "@/components/Layout/Sidebar";
import { TopBar } from "@/components/Layout/TopBar";
import { NewIssueModal } from "@/components/Modals/NewIssueModal";
import { useTasks } from "@/hooks/useTasks";
import type { Task } from "@/utils/tasks.types";
import styles from "./AppShell.module.css";

export function AppShell() {
  const { data: tasks = [] } = useTasks();
  const [currentView, setCurrentView] = useState<View>("Board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newIssueOpen, setNewIssueOpen] = useState(false);

  const agentActive = tasks.some((t) => t.status === "In Progress");

  return (
    <div className={styles.shell}>
      <Sidebar
        currentView={currentView}
        agentActive={agentActive}
        onViewChange={setCurrentView}
      />

      <main className={styles.main}>
        <TopBar
          currentView={currentView}
          onNewIssue={() => setNewIssueOpen(true)}
        />

        <div className={styles.content}>
          {currentView === "Board" ? (
            <Board
              tasks={tasks.filter((t) => t.status !== "Backlog")}
              onSelectTask={setSelectedTask}
            />
          ) : (
            <Backlog onSelectTask={setSelectedTask} />
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

      <NewIssueModal
        open={newIssueOpen}
        onClose={() => setNewIssueOpen(false)}
      />
    </div>
  );
}
```

**Step 3: Update page.tsx**

```tsx
// src/app/page.tsx
import { AppShell } from "./AppShell";

export default function Page() {
  return <AppShell />;
}
```

**Step 4: Commit**

```bash
git add src/app/AppShell.tsx src/app/AppShell.module.css src/app/page.tsx
git commit -m "feat: add AppShell and wire board, sidebar, spec editor together"
```

---

## Task 19: Update barrel exports and run full build check

**Files:**

- Modify: `src/components/index.ts`

**Step 1: Update barrel exports**

Replace the contents of `src/components/index.ts` with:

```ts
export * from "./Board/Backlog";
export * from "./Board/Board";
export * from "./Board/Column";
export * from "./Board/TaskCard";
export * from "./Editor/LexicalEditor";
export * from "./Editor/SpecEditor";
export * from "./InstanceCard";
export * from "./Layout/Sidebar";
export * from "./Layout/TopBar";
export * from "./Modals/NewIssueModal";
export * from "./Terminal";
```

**Step 2: Run linter**

```bash
yarn lint
```

Fix any import order violations or TypeScript errors reported.

**Step 3: Run build**

```bash
yarn build
```

Expected: Build succeeds with no TypeScript errors.

**Step 4: Run dev and manually verify**

```bash
yarn dev
```

Open http://localhost:3000 and verify:

- [ ] Sidebar shows Board / Backlog nav
- [ ] Board renders 4 columns (Not Started, In Progress, Review, Done)
- [ ] "New Issue" button opens modal, creates task in Backlog
- [ ] Switching to Backlog view shows task list with inline create form
- [ ] Clicking a task opens SpecEditor slide-in panel
- [ ] Typing in Lexical editor and saving works
- [ ] "Handover to Claude" button fires POST /api/tasks/:id/handover
- [ ] Task moves to In Progress with agent pulse animation
- [ ] In Progress task card shows "Terminal →" link to /session/:id

**Step 5: Final commit**

```bash
git add src/components/index.ts
git commit -m "feat: update barrel exports for all new board components"
```

---

## Summary

| Task | What it does                                       |
| ---- | -------------------------------------------------- |
| 1    | Install Lexical                                    |
| 2    | Add QueryClientProvider                            |
| 3    | Add design tokens (spacing, radius, type, shimmer) |
| 4    | Task type definitions                              |
| 5    | Server: task REST endpoints                        |
| 6    | Server: handover + board WebSocket                 |
| 7    | useTasks TanStack Query hooks                      |
| 8    | useTasksSocket live sync hook                      |
| 9    | Sidebar layout component                           |
| 10   | TopBar layout component                            |
| 11   | Column DnD droppable                               |
| 12   | TaskCard sortable with agent pulse                 |
| 13   | Board DnD context                                  |
| 14   | Backlog view                                       |
| 15   | LexicalEditor rich text                            |
| 16   | SpecEditor slide-in panel                          |
| 17   | NewIssueModal                                      |
| 18   | AppShell wiring                                    |
| 19   | Barrel exports + build verify                      |
