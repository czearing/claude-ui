# Markdown Task Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single `tasks.json` flat file with individual `.md` files per task, organized under `specs/<repoId>/`, making task specs human- and AI-readable.

**Architecture:** Each task becomes a YAML-frontmatter markdown file. Metadata (id, status, priority, timestamps, sessionId) lives in the frontmatter; the task spec lives in the markdown body as plain prose. The server's read/write functions are swapped for file-per-task helpers. The Lexical editor is updated to read/write markdown instead of its internal JSON format.

**Tech Stack:** Node.js `fs/promises` (already used), `@lexical/markdown` `$convertFromMarkdownString` / `$convertToMarkdownString` (already in deps via `@lexical/react`), no new packages.

---

## File Format (reference)

Every task file looks like this:

```markdown
---
id: TASK-001
title: Build the task board
status: Backlog
priority: Medium
repoId: abc-123-def-456
createdAt: 2024-01-01T00:00:00.000Z
updatedAt: 2024-01-01T00:00:00.000Z
---

Implement a kanban board with columns for Backlog, Not Started, In Progress, Review, and Done.

## Requirements

- Drag and drop support
- Real-time updates via WebSocket
```

`sessionId` is omitted when absent. The body (spec) is plain markdown — empty string is fine.

Storage path: `specs/<repoId>/TASK-001.md` (relative to `process.cwd()`).

---

### Task 1: Add file-based task helpers to server.ts (no API changes yet)

**Files:**

- Modify: `server.ts` (add helpers after the existing `writeTasks` function, ~line 84)

**Step 1: Write the failing test — parse round-trip**

We can't unit-test server.ts directly, so verify by adding a comment-block unit test. Instead, write the helpers carefully with inline test cases in comments, then verify manually in Task 5.

Skip this step — proceed to Step 2.

**Step 2: Add imports at the top of server.ts**

The `mkdir` and `readdir` functions are needed. Add to the existing import block:

```typescript
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
```

**Step 3: Add the SPECS_DIR constant after REPOS_FILE**

```typescript
const SPECS_DIR = join(process.cwd(), "specs");
```

**Step 4: Add `parseTaskFile` helper**

Add after the `SPECS_DIR` constant:

```typescript
function parseTaskFile(content: string): Task {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content);
  if (!match) throw new Error("Invalid task file: missing frontmatter");
  const frontmatter = match[1];
  const body = match[2].trim();

  const meta: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(": ");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 2).trim();
    if (key) meta[key] = value;
  }

  const task: Task = {
    id: meta["id"] ?? "",
    title: meta["title"] ?? "",
    status: (meta["status"] as TaskStatus) ?? "Backlog",
    priority: (meta["priority"] as Priority) ?? "Medium",
    repoId: meta["repoId"] ?? "",
    spec: body,
    createdAt: meta["createdAt"] ?? new Date().toISOString(),
    updatedAt: meta["updatedAt"] ?? new Date().toISOString(),
  };
  if (meta["sessionId"]) task.sessionId = meta["sessionId"];
  return task;
}
```

**Step 5: Add `serializeTaskFile` helper**

```typescript
function serializeTaskFile(task: Task): string {
  const lines = [
    "---",
    `id: ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `priority: ${task.priority}`,
    `repoId: ${task.repoId}`,
  ];
  if (task.sessionId) lines.push(`sessionId: ${task.sessionId}`);
  lines.push(`createdAt: ${task.createdAt}`);
  lines.push(`updatedAt: ${task.updatedAt}`);
  lines.push("---");
  lines.push("");
  if (task.spec) lines.push(task.spec);
  return lines.join("\n");
}
```

**Step 6: Add `repoSpecsDir` helper + `ensureSpecsDir`**

```typescript
function repoSpecsDir(repoId: string): string {
  return join(SPECS_DIR, repoId);
}

async function ensureSpecsDir(repoId: string): Promise<void> {
  await mkdir(repoSpecsDir(repoId), { recursive: true });
}
```

**Step 7: Add `readTask`, `writeTask`, `deleteTaskFile`, `readTasksForRepo`, `readAllTasks`**

```typescript
async function readTask(id: string, repoId: string): Promise<Task | null> {
  try {
    const raw = await readFile(join(repoSpecsDir(repoId), `${id}.md`), "utf8");
    return parseTaskFile(raw);
  } catch {
    return null;
  }
}

async function writeTask(task: Task): Promise<void> {
  await ensureSpecsDir(task.repoId);
  await writeFile(
    join(repoSpecsDir(task.repoId), `${task.id}.md`),
    serializeTaskFile(task),
    "utf8",
  );
}

async function deleteTaskFile(id: string, repoId: string): Promise<void> {
  try {
    await unlink(join(repoSpecsDir(repoId), `${id}.md`));
  } catch {
    // ignore if already gone
  }
}

async function readTasksForRepo(repoId: string): Promise<Task[]> {
  try {
    const dir = repoSpecsDir(repoId);
    const files = await readdir(dir);
    const tasks = await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map((f) => readTask(f.slice(0, -3), repoId)),
    );
    return tasks.filter((t): t is Task => t !== null);
  } catch {
    return [];
  }
}

async function readAllTasks(): Promise<Task[]> {
  try {
    const dirs = await readdir(SPECS_DIR);
    const groups = await Promise.all(
      dirs.map(async (dir) => {
        try {
          const s = await stat(join(SPECS_DIR, dir));
          return s.isDirectory() ? readTasksForRepo(dir) : [];
        } catch {
          return [];
        }
      }),
    );
    return groups.flat();
  } catch {
    return [];
  }
}
```

**Step 8: Add `getNextTaskId`**

```typescript
async function getNextTaskId(): Promise<string> {
  let max = 0;
  try {
    const dirs = await readdir(SPECS_DIR);
    for (const dir of dirs) {
      try {
        const s = await stat(join(SPECS_DIR, dir));
        if (!s.isDirectory()) continue;
        const files = await readdir(join(SPECS_DIR, dir));
        for (const file of files) {
          const m = /^TASK-(\d+)\.md$/.exec(file);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > max) max = n;
          }
        }
      } catch {
        // skip unreadable dirs
      }
    }
  } catch {
    // SPECS_DIR doesn't exist yet
  }
  return `TASK-${String(max + 1).padStart(3, "0")}`;
}
```

**Step 9: Verify server.ts compiles**

Run: `yarn tsc --noEmit`
Expected: no errors

**Step 10: Commit**

```bash
git add server.ts
git commit -m "feat: add file-based task storage helpers to server.ts"
```

---

### Task 2: Swap all task API handlers to use file-based I/O

**Files:**

- Modify: `server.ts`

All changes in this task are in the `.then(async () => {` block and the `scheduleIdleStatus` / `ptyProcess.onExit` callbacks.

**Step 1: Replace `GET /api/tasks` handler**

Find:

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

Replace with:

```typescript
// GET /api/tasks
if (req.method === "GET" && parsedUrl.pathname === "/api/tasks") {
  const repoId = parsedUrl.query["repoId"] as string | undefined;
  const result = repoId ? await readTasksForRepo(repoId) : await readAllTasks();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
  return;
}
```

**Step 2: Replace `POST /api/tasks` handler**

Find:

```typescript
// POST /api/tasks
if (req.method === "POST" && parsedUrl.pathname === "/api/tasks") {
  const body = await readBody(req);
  const tasks = await readTasks();
  const now = new Date().toISOString();
  const task: Task = {
    id: generateTaskId(tasks),
    title: typeof body["title"] === "string" ? body["title"] : "",
    status: (body["status"] as TaskStatus) ?? "Backlog",
    priority: (body["priority"] as Priority) ?? "Medium",
    spec: typeof body["spec"] === "string" ? body["spec"] : "",
    repoId: typeof body["repoId"] === "string" ? body["repoId"] : "default",
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
```

Replace with:

```typescript
// POST /api/tasks
if (req.method === "POST" && parsedUrl.pathname === "/api/tasks") {
  const body = await readBody(req);
  const now = new Date().toISOString();
  const task: Task = {
    id: await getNextTaskId(),
    title: typeof body["title"] === "string" ? body["title"] : "",
    status: (body["status"] as TaskStatus) ?? "Backlog",
    priority: (body["priority"] as Priority) ?? "Medium",
    spec: typeof body["spec"] === "string" ? body["spec"] : "",
    repoId: typeof body["repoId"] === "string" ? body["repoId"] : "default",
    createdAt: now,
    updatedAt: now,
  };
  await writeTask(task);
  broadcastTaskEvent("task:created", task);
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify(task));
  return;
}
```

**Step 3: Replace `PATCH /api/tasks/:id` handler**

Find:

```typescript
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
    ...tasks[idx],
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
```

Replace with:

```typescript
// PATCH /api/tasks/:id
if (
  req.method === "PATCH" &&
  parsedUrl.pathname?.startsWith("/api/tasks/") &&
  !parsedUrl.pathname.endsWith("/handover")
) {
  const id = parsedUrl.pathname.slice("/api/tasks/".length);
  const body = await readBody(req);
  const existing = await readAllTasks().then((ts) =>
    ts.find((t) => t.id === id),
  );
  if (!existing) {
    res.writeHead(404);
    res.end();
    return;
  }
  const updated: Task = {
    ...existing,
    ...body,
    id,
    repoId: existing.repoId,
    updatedAt: new Date().toISOString(),
  } as Task;
  await writeTask(updated);
  broadcastTaskEvent("task:updated", updated);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(updated));
  return;
}
```

**Step 4: Replace `DELETE /api/tasks/:id` handler**

Find:

```typescript
// DELETE /api/tasks/:id
if (req.method === "DELETE" && parsedUrl.pathname?.startsWith("/api/tasks/")) {
  const id = parsedUrl.pathname.slice("/api/tasks/".length);
  const tasks = await readTasks();
  const taskToDelete = tasks.find((t) => t.id === id);
  const filtered = tasks.filter((t) => t.id !== id);
  await writeTasks(filtered);
  broadcastTaskEvent("task:deleted", {
    id,
    repoId: taskToDelete?.repoId,
  });
  res.writeHead(204);
  res.end();
  return;
}
```

Replace with:

```typescript
// DELETE /api/tasks/:id
if (req.method === "DELETE" && parsedUrl.pathname?.startsWith("/api/tasks/")) {
  const id = parsedUrl.pathname.slice("/api/tasks/".length);
  const taskToDelete = await readAllTasks().then((ts) =>
    ts.find((t) => t.id === id),
  );
  if (taskToDelete) {
    await deleteTaskFile(id, taskToDelete.repoId);
  }
  broadcastTaskEvent("task:deleted", {
    id,
    repoId: taskToDelete?.repoId,
  });
  res.writeHead(204);
  res.end();
  return;
}
```

**Step 5: Replace `POST /api/tasks/:id/recall` handler**

Find:

```typescript
const tasks = await readTasks();
const idx = tasks.findIndex((t) => t.id === id);
if (idx === -1) {
  res.writeHead(404);
  res.end();
  return;
}
const oldSessionId = tasks[idx].sessionId;
const updatedTask: Task = {
  ...tasks[idx],
  status: "Backlog",
  updatedAt: new Date().toISOString(),
};
delete updatedTask.sessionId;
tasks[idx] = updatedTask;
await writeTasks(tasks);
broadcastTaskEvent("task:updated", updatedTask);
```

Replace with:

```typescript
const existing = await readAllTasks().then((ts) => ts.find((t) => t.id === id));
if (!existing) {
  res.writeHead(404);
  res.end();
  return;
}
const oldSessionId = existing.sessionId;
const updatedTask: Task = {
  ...existing,
  status: "Backlog",
  updatedAt: new Date().toISOString(),
};
delete updatedTask.sessionId;
await writeTask(updatedTask);
broadcastTaskEvent("task:updated", updatedTask);
```

**Step 6: Replace `POST /api/tasks/:id/handover` handler — find the task**

Find:

```typescript
const tasks = await readTasks();
const idx = tasks.findIndex((t) => t.id === id);
if (idx === -1) {
  res.writeHead(404);
  res.end();
  return;
}
const task = tasks[idx];
```

Replace with:

```typescript
const task = await readAllTasks().then((ts) => ts.find((t) => t.id === id));
if (!task) {
  res.writeHead(404);
  res.end();
  return;
}
```

**Step 7: Replace `POST /api/tasks/:id/handover` — simplify spec extraction + update task write**

The `extractTextFromLexical` call becomes unnecessary for new markdown specs. Update the spec extraction:

Find:

```typescript
const specText = extractTextFromLexical(task.spec);
```

Replace with:

```typescript
// spec is now plain markdown — strip any remaining Lexical JSON gracefully
const specText = extractTextFromLexical(task.spec);
```

(No change needed — `extractTextFromLexical` still works as a fallback. Leave it.)

Then find the block that writes the updated task at end of handover:

```typescript
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
```

Replace with:

```typescript
const inProgressTask: Task = {
  ...task,
  sessionId,
  status: "In Progress",
  updatedAt: new Date().toISOString(),
};
await writeTask(inProgressTask);
broadcastTaskEvent("task:updated", inProgressTask);

res.writeHead(200, { "Content-Type": "application/json" });
res.end(JSON.stringify(inProgressTask));
```

**Step 8: Replace idle-status auto-advance (Review transition after idle)**

Find the two `void readTasks().then(` calls inside `scheduleIdleStatus` and `ptyProcess.onExit`:

In `scheduleIdleStatus`, find:

```typescript
void readTasks().then((current) => {
  const taskIdx = current.findIndex((t) => t.sessionId === sessionId);
  if (taskIdx !== -1 && current[taskIdx].status === "In Progress") {
    current[taskIdx] = {
      ...current[taskIdx],
      status: "Review",
      updatedAt: new Date().toISOString(),
    };
    void writeTasks(current).then(() =>
      broadcastTaskEvent("task:updated", current[taskIdx]),
    );
  }
});
```

Replace with:

```typescript
void readAllTasks().then((current) => {
  const task = current.find((t) => t.sessionId === sessionId);
  if (task && task.status === "In Progress") {
    const updated: Task = {
      ...task,
      status: "Review",
      updatedAt: new Date().toISOString(),
    };
    void writeTask(updated).then(() =>
      broadcastTaskEvent("task:updated", updated),
    );
  }
});
```

In `ptyProcess.onExit`, find the other `void readTasks().then(` block and apply the same replacement.

**Step 9: Verify compilation**

Run: `yarn tsc --noEmit`
Expected: no errors

**Step 10: Commit**

```bash
git add server.ts
git commit -m "feat: swap task API handlers to file-based storage"
```

---

### Task 3: Migrate existing tasks.json on startup

**Files:**

- Modify: `server.ts` — `ensureDefaultRepo()` function

**Step 1: Add migration logic at end of `ensureDefaultRepo`**

Find the closing `}` of `ensureDefaultRepo`. Before it, add:

```typescript
// Migrate tasks.json → individual markdown files
const tasksFilePath = join(process.cwd(), "tasks.json");
try {
  const raw = await readFile(tasksFilePath, "utf8");
  const legacyTasks = JSON.parse(raw) as Task[];
  for (const t of legacyTasks) {
    const existing = await readTask(t.id, t.repoId);
    if (existing) continue; // already migrated
    const migratedTask: Task = {
      ...t,
      spec: extractTextFromLexical(t.spec), // convert Lexical JSON → plain text
    };
    await writeTask(migratedTask);
  }
  // Rename tasks.json → tasks.json.bak so migration doesn't re-run
  await rename(tasksFilePath, tasksFilePath + ".bak");
  console.log(`[tasks] Migrated ${legacyTasks.length} tasks to markdown files`);
} catch {
  // tasks.json doesn't exist — nothing to migrate
}
```

**Step 2: Verify compilation**

Run: `yarn tsc --noEmit`
Expected: no errors

**Step 3: Start the server and verify migration (manual)**

If a `tasks.json` exists:

1. Run `yarn dev`
2. Check that `specs/<repoId>/` directories and `.md` files were created
3. Check that `tasks.json.bak` exists
4. Open the board in the browser and confirm tasks appear

**Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: auto-migrate tasks.json to markdown files on startup"
```

---

### Task 4: Update LexicalEditor to read/write markdown

**Files:**

- Modify: `src/components/Editor/LexicalEditor/LexicalEditor.tsx`

The editor currently stores Lexical JSON in `spec`. We want it to store plain markdown going forward. Old Lexical JSON specs should still load (via the try/catch in `StateLoader`).

**Step 1: Add markdown imports to LexicalEditor.tsx**

Find:

```typescript
import { TRANSFORMERS } from "@lexical/markdown";
```

Replace with:

```typescript
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
```

**Step 2: Update `StateLoader` to fall back to markdown conversion**

Find:

```typescript
function StateLoader({ value }: { value?: string }) {
  const [editor] = useLexicalComposerContext();
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current || !value) {
      return;
    }
    didInitRef.current = true;
    try {
      const state = editor.parseEditorState(value);
      editor.setEditorState(state);
    } catch {
      // ignore invalid state
    }
  }, [editor, value]);
  return null;
}
```

Replace with:

```typescript
function StateLoader({ value }: { value?: string }) {
  const [editor] = useLexicalComposerContext();
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current || !value) {
      return;
    }
    didInitRef.current = true;
    try {
      // Legacy: try Lexical JSON format first
      const state = editor.parseEditorState(value);
      editor.setEditorState(state);
    } catch {
      // New: treat value as plain markdown
      editor.update(() => {
        $convertFromMarkdownString(value, TRANSFORMERS);
      });
    }
  }, [editor, value]);
  return null;
}
```

**Step 3: Update `handleChange` to output markdown**

Find:

```typescript
const handleChange = (editorState: EditorState) => {
  onChange?.(JSON.stringify(editorState.toJSON()));
};
```

Replace with:

```typescript
const handleChange = (editorState: EditorState) => {
  editorState.read(() => {
    onChange?.($convertToMarkdownString(TRANSFORMERS));
  });
};
```

**Step 4: Verify compilation**

Run: `yarn tsc --noEmit`
Expected: no errors

**Step 5: Run existing Lexical editor tests**

Run: `yarn test src/components/Editor/LexicalEditor/LexicalEditor.test.tsx`
Expected: all pass

**Step 6: Commit**

```bash
git add src/components/Editor/LexicalEditor/LexicalEditor.tsx
git commit -m "feat: LexicalEditor saves as markdown, loads legacy JSON with fallback"
```

---

### Task 5: Smoke test end-to-end

**Step 1: Start the dev server**

Run: `yarn dev`
Expected: server starts on port 3000 with no errors

**Step 2: Manual smoke test**

1. Open `http://localhost:3000`
2. Create a new task — type a title and some markdown spec (use `## Headers`, `- lists`, `**bold**`)
3. Click save / navigate away and back — spec should round-trip correctly
4. Open `specs/<repoId>/TASK-NNN.md` in a text editor — should show YAML frontmatter + plain markdown body
5. Create a new `.md` file manually in the `specs/<repoId>/` folder following the format — reload the board and verify it appears
6. Update status via drag — verify the `.md` file's frontmatter updates
7. Delete a task — verify the `.md` file is removed

**Step 3: Fix any issues found**

If tasks don't appear after manual file creation, check:

- Frontmatter format matches exactly (double-space after `:`)
- `repoId` in the file matches an existing repo in `repos.json`
- File is named `TASK-NNN.md` (case-sensitive)

**Step 4: Commit any fixes, then final commit**

```bash
git add .
git commit -m "fix: resolve smoke test issues with markdown task storage"
```

---

## Notes for AI-created task files

An AI agent can add new tasks to the board by creating a file at:

```
specs/<repoId>/TASK-NNN.md
```

Where `<repoId>` is found in `repos.json` and `NNN` is one higher than the current max task number. The minimum valid file is:

```markdown
---
id: TASK-042
title: My new task
status: Backlog
priority: Medium
repoId: <paste-repoId-here>
createdAt: 2026-02-25T00:00:00.000Z
updatedAt: 2026-02-25T00:00:00.000Z
---

Describe the task spec here in plain markdown.
```

The server picks up the file on the next `GET /api/tasks` request — no restart needed.
