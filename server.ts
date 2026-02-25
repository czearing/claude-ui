import next from "next";
import * as pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";

import { parseClaudeStatus } from "./src/utils/parseClaudeStatus";
import {
  loadRegistry,
  saveRegistry,
  type SessionRegistryEntry,
} from "./src/utils/sessionRegistry";

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "node:url";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev });
const handle = app.getRequestHandler();

const command = process.platform === "win32" ? "claude.cmd" : "claude";

const BUFFER_CAP = 500 * 1024; // 500 KB rolling buffer per session

// Window after writing the spec to the PTY during which output is treated as
// echo/startup noise rather than meaningful Claude activity.  Any onData event
// that fires more than this many ms after spec injection is counted as
// "meaningful activity", which gates the waiting → Review transition.
const SPEC_ECHO_WINDOW_MS = 500;

type ClaudeStatus =
  | "connecting"
  | "thinking"
  | "typing"
  | "waiting"
  | "exited"
  | "disconnected";

type HandoverPhase = "spec_sent" | "done";

type SessionEntry = {
  pty: pty.IPty;
  outputBuffer: Buffer[];
  bufferSize: number;
  activeWs: WebSocket | null;
  currentStatus: ClaudeStatus;
  // null for non-handover sessions
  handoverPhase: HandoverPhase | null;
  handoverSpec: string;
  specSentAt: number;
  hadMeaningfulActivity: boolean;
};

const sessions = new Map<string, SessionEntry>();

// ─── Session Registry (persistent across server restarts) ────────────────────

const SESSIONS_REGISTRY_FILE = join(process.cwd(), "sessions-registry.json");

const sessionRegistry = new Map<string, SessionRegistryEntry>();

async function loadSessionRegistry(): Promise<void> {
  const loaded = await loadRegistry(SESSIONS_REGISTRY_FILE);
  for (const [k, v] of loaded) {
    sessionRegistry.set(k, v);
  }
}

const saveSessionRegistry = (): Promise<void> =>
  saveRegistry(SESSIONS_REGISTRY_FILE, sessionRegistry);

// ─── Tasks ─────────────────────────────────────────────────────────────────────────────────

const TASKS_FILE = join(process.cwd(), "tasks.json");
const REPOS_FILE = join(process.cwd(), "repos.json");
const SPECS_DIR = join(process.cwd(), "specs");

type TaskStatus = "Backlog" | "Not Started" | "In Progress" | "Review" | "Done";
type Priority = "Low" | "Medium" | "High" | "Urgent";

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  spec: string;
  repoId: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

interface Repo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
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
  if (meta["archivedAt"]) task.archivedAt = meta["archivedAt"];
  return task;
}

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
  if (task.archivedAt) lines.push(`archivedAt: ${task.archivedAt}`);
  lines.push(`createdAt: ${task.createdAt}`);
  lines.push(`updatedAt: ${task.updatedAt}`);
  lines.push("---");
  lines.push("");
  if (task.spec) lines.push(task.spec);
  return lines.join("\n");
}

// ─── Skills ────────────────────────────────────────────────────────────────

const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;

type Skill = { name: string; description: string; content: string };

function globalSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

function skillFile(dir: string, name: string): string {
  return join(dir, name, "SKILL.md");
}

async function ensureSkillsDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function resolveSkillsDir(
  scope: string,
  repoId: string | null,
): Promise<string> {
  if (scope === "repo" && repoId) {
    const repos = await readRepos();
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) throw new Error("Repo not found");
    return join(repo.path, ".claude", "skills");
  }
  return globalSkillsDir();
}

function parseSkillFile(raw: string, name: string): Skill {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { name, description: "", content: raw.trim() };
  const front = m[1];
  const body = m[2].trim();
  const descMatch = front.match(/^description:\s*(.+)$/m);
  return {
    name,
    description: descMatch ? descMatch[1].trim() : "",
    content: body,
  };
}

function serializeSkillFile(skill: Skill): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.content}`;
}

async function listSkills(
  dir: string,
): Promise<{ name: string; description: string }[]> {
  await ensureSkillsDir(dir);
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { name: string; description: string }[] = [];
  await Promise.all(
    entries
      .filter((e) => e.isDirectory())
      .map(async (e) => {
        try {
          const raw = await readFile(join(dir, e.name, "SKILL.md"), "utf8");
          const parsed = parseSkillFile(raw, e.name);
          results.push({
            name: parsed.name || e.name,
            description: parsed.description,
          });
        } catch {
          // directory exists but no SKILL.md — skip
        }
      }),
  );
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function readSkill(dir: string, name: string): Promise<Skill | null> {
  try {
    const raw = await readFile(skillFile(dir, name), "utf8");
    return parseSkillFile(raw, name);
  } catch {
    return null;
  }
}

async function writeSkill(dir: string, skill: Skill): Promise<void> {
  await mkdir(join(dir, skill.name), { recursive: true });
  await writeFile(
    skillFile(dir, skill.name),
    serializeSkillFile(skill),
    "utf8",
  );
}

async function deleteSkill(dir: string, name: string): Promise<void> {
  await rm(join(dir, name), { recursive: true, force: true });
}

// ─── Agents ─────────────────────────────────────────────────────────────────

const AGENT_NAME_RE = /^[a-z0-9-]{1,64}$/;

type Agent = { name: string; description: string; content: string };

function globalAgentsDir(): string {
  return join(homedir(), ".claude", "agents");
}

function agentFile(dir: string, name: string): string {
  return join(dir, `${name}.md`);
}

async function ensureAgentsDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function resolveAgentsDir(
  scope: string,
  repoId: string | null,
): Promise<string> {
  if (scope === "repo" && repoId) {
    const repos = await readRepos();
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) throw new Error("Repo not found");
    return join(repo.path, ".claude", "agents");
  }
  return globalAgentsDir();
}

function parseAgentFile(raw: string, name: string): Agent {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { name, description: "", content: raw.trim() };
  const front = m[1];
  const body = m[2].trim();
  const descMatch = front.match(/^description:\s*(.+)$/m);
  return {
    name,
    description: descMatch ? descMatch[1].trim() : "",
    content: body,
  };
}

function serializeAgentFile(agent: Agent): string {
  return `---\nname: ${agent.name}\ndescription: ${agent.description}\n---\n\n${agent.content}`;
}

async function listAgents(
  dir: string,
): Promise<{ name: string; description: string }[]> {
  await ensureAgentsDir(dir);
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { name: string; description: string }[] = [];
  await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map(async (e) => {
        const name = e.name.slice(0, -3); // strip .md
        try {
          const raw = await readFile(join(dir, e.name), "utf8");
          const parsed = parseAgentFile(raw, name);
          results.push({
            name: parsed.name || name,
            description: parsed.description,
          });
        } catch {
          // unreadable file — skip
        }
      }),
  );
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function readAgent(dir: string, name: string): Promise<Agent | null> {
  try {
    const raw = await readFile(agentFile(dir, name), "utf8");
    return parseAgentFile(raw, name);
  } catch {
    return null;
  }
}

async function writeAgent(dir: string, agent: Agent): Promise<void> {
  await ensureAgentsDir(dir);
  await writeFile(
    agentFile(dir, agent.name),
    serializeAgentFile(agent),
    "utf8",
  );
}

async function deleteAgent(dir: string, name: string): Promise<void> {
  try {
    await unlink(agentFile(dir, name));
  } catch {
    // file already gone — ignore
  }
}

function repoSpecsDir(repoId: string): string {
  return join(SPECS_DIR, repoId);
}

async function ensureSpecsDir(repoId: string): Promise<void> {
  await mkdir(repoSpecsDir(repoId), { recursive: true });
}

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

async function ensureDefaultRepo(): Promise<void> {
  const repos = await readRepos();
  if (repos.length > 0) {
    return;
  }

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
    console.log(
      `[tasks] Migrated ${legacyTasks.length} tasks to markdown files`,
    );
  } catch {
    // tasks.json doesn't exist — nothing to migrate
  }
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
      if (typeof node !== "object" || node === null) {
        return;
      }
      const n = node as Record<string, unknown>;
      if (n["type"] === "text" && typeof n["text"] === "string") {
        texts.push(n["text"]);
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

function appendToBuffer(entry: SessionEntry, chunk: Buffer): void {
  entry.outputBuffer.push(chunk);
  entry.bufferSize += chunk.byteLength;
  while (entry.bufferSize > BUFFER_CAP && entry.outputBuffer.length > 1) {
    const removed = entry.outputBuffer.shift()!;
    entry.bufferSize -= removed.byteLength;
  }
}

function emitStatus(ws: WebSocket | null, status: ClaudeStatus): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "status", value: status }));
  }
}

function advanceToReview(sessionId: string): void {
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
}

app
  .prepare()
  .then(async () => {
    await ensureDefaultRepo();
    await loadSessionRegistry();

    const server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url!, true);

        // GET /api/tasks
        if (req.method === "GET" && parsedUrl.pathname === "/api/tasks") {
          const repoId = parsedUrl.query["repoId"] as string | undefined;
          const result = repoId
            ? await readTasksForRepo(repoId)
            : await readAllTasks();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
          return;
        }

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
            repoId:
              typeof body["repoId"] === "string" ? body["repoId"] : "default",
            createdAt: now,
            updatedAt: now,
          };
          await writeTask(task);
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
          const existing = await readAllTasks().then((ts) =>
            ts.find((t) => t.id === id),
          );
          if (!existing) {
            res.writeHead(404);
            res.end();
            return;
          }
          const now = new Date().toISOString();
          const becomingDone = body.status === "Done";
          const leavingDone =
            body.status !== undefined &&
            body.status !== "Done" &&
            existing.status === "Done";

          const updated: Task = {
            ...existing,
            ...body,
            id,
            repoId: existing.repoId,
            updatedAt: now,
            archivedAt: becomingDone
              ? (existing.archivedAt ?? now) // stamp once; don't overwrite if already set
              : leavingDone
                ? undefined // clear when restoring
                : existing.archivedAt, // unchanged
          } as Task;
          await writeTask(updated);
          broadcastTaskEvent("task:updated", updated);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(updated));
          return;
        }

        // DELETE /api/tasks/:id
        if (
          req.method === "DELETE" &&
          parsedUrl.pathname?.startsWith("/api/tasks/")
        ) {
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

        // POST /api/tasks/:id/recall
        if (
          req.method === "POST" &&
          parsedUrl.pathname?.startsWith("/api/tasks/") &&
          parsedUrl.pathname.endsWith("/recall")
        ) {
          const id = parsedUrl.pathname.slice(
            "/api/tasks/".length,
            -"/recall".length,
          );
          const existing = await readAllTasks().then((ts) =>
            ts.find((t) => t.id === id),
          );
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
          if (oldSessionId) {
            const entry = sessions.get(oldSessionId);
            if (entry) {
              entry.activeWs = null;
              entry.pty.kill();
              sessions.delete(oldSessionId);
            }
            sessionRegistry.delete(oldSessionId);
            void saveSessionRegistry();
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(updatedTask));
          return;
        }

        // POST /api/tasks/:id/handover
        if (
          req.method === "POST" &&
          parsedUrl.pathname?.endsWith("/handover")
        ) {
          const id = parsedUrl.pathname.slice(
            "/api/tasks/".length,
            -"/handover".length,
          );
          const task = await readAllTasks().then((ts) =>
            ts.find((t) => t.id === id),
          );
          if (!task) {
            res.writeHead(404);
            res.end();
            return;
          }
          const sessionId = randomUUID();
          // Build the prompt: title + spec body (extracted from Lexical JSON
          // or passed through as plain text).
          const plainSpec = extractTextFromLexical(task.spec);
          const specText = `${task.title}\n\n${plainSpec}`.trim();

          // Empty spec — nothing for Claude to do; advance straight to Review.
          if (!specText) {
            const reviewTask: Task = {
              ...task,
              status: "Review",
              updatedAt: new Date().toISOString(),
            };
            await writeTask(reviewTask);
            broadcastTaskEvent("task:updated", reviewTask);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(reviewTask));
            return;
          }

          // Look up the repo path for this task
          const repos = await readRepos();
          const repo = repos.find((r) => r.id === task.repoId);
          const cwd = repo?.path ?? process.cwd();

          let ptyProcess: pty.IPty;
          try {
            // Pass the spec directly as a CLI argument so Claude starts
            // processing immediately — no need to wait for the REPL idle
            // state and inject via PTY write.
            ptyProcess = pty.spawn(
              command,
              ["--dangerously-skip-permissions", specText],
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

          const entry: SessionEntry = {
            pty: ptyProcess,
            outputBuffer: [],
            bufferSize: 0,
            activeWs: null,
            currentStatus: "connecting",
            handoverPhase: "spec_sent",
            handoverSpec: specText,
            specSentAt: Date.now(),
            hadMeaningfulActivity: false,
          };
          sessions.set(sessionId, entry);
          sessionRegistry.set(sessionId, {
            id: sessionId,
            cwd,
            taskId: task.id,
            createdAt: new Date().toISOString(),
          });
          void saveSessionRegistry();

          ptyProcess.onData((data) => {
            const chunk = Buffer.from(data);
            const e = sessions.get(sessionId);
            if (!e) {
              return;
            }

            appendToBuffer(e, chunk);
            if (e.activeWs?.readyState === WebSocket.OPEN) {
              e.activeWs.send(chunk);
            }

            const parsed = parseClaudeStatus(data);
            if (parsed !== null && parsed !== e.currentStatus) {
              e.currentStatus = parsed;
              emitStatus(e.activeWs, parsed);
            }

            // Track meaningful activity (thinking/typing) after the echo window
            if (
              e.handoverPhase === "spec_sent" &&
              !e.hadMeaningfulActivity &&
              (parsed === "thinking" || parsed === "typing") &&
              Date.now() - e.specSentAt > SPEC_ECHO_WINDOW_MS
            ) {
              e.hadMeaningfulActivity = true;
            }

            // Advance to Review when Claude shows the prompt after meaningful work
            if (
              e.handoverPhase === "spec_sent" &&
              parsed === "waiting" &&
              e.hadMeaningfulActivity
            ) {
              e.handoverPhase = "done";
              advanceToReview(sessionId);
            }
          });

          ptyProcess.onExit(({ exitCode }) => {
            const e = sessions.get(sessionId);
            // Use explicit undefined check: `undefined !== null` would
            // spuriously set isHandover=true when the session was already
            // removed (e.g. by recall before the process exited).
            const isHandover = e !== undefined && e.handoverPhase !== null;
            const wasHandoverDone = e?.handoverPhase === "done";
            if (e) {
              e.currentStatus = "exited";
              if (e.activeWs?.readyState === WebSocket.OPEN) {
                e.activeWs.send(
                  JSON.stringify({ type: "exit", code: exitCode }),
                );
                e.activeWs.close();
              }
            }
            sessions.delete(sessionId);

            // Fallback: if the process exits before the state machine could
            // advance to Review (e.g. Claude crashed), do it now.
            if (isHandover && !wasHandoverDone) {
              advanceToReview(sessionId);
            }
          });

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
          return;
        }

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
          sessionRegistry.delete(id);
          void saveSessionRegistry();
          res.writeHead(204);
          res.end();
          return;
        }

        // GET /api/skills
        if (req.method === "GET" && parsedUrl.pathname === "/api/skills") {
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveSkillsDir(scope, repoId);
          const skills = await listSkills(dir);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ skills }));
          return;
        }

        // GET /api/skills/:name
        if (
          req.method === "GET" &&
          parsedUrl.pathname?.startsWith("/api/skills/") &&
          parsedUrl.pathname !== "/api/skills/"
        ) {
          const name = parsedUrl.pathname.slice("/api/skills/".length);
          if (!SKILL_NAME_RE.test(name)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid skill name" }));
            return;
          }
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveSkillsDir(scope, repoId);
          const skill = await readSkill(dir, name);
          if (skill === null) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(skill));
          return;
        }

        // POST /api/skills
        if (req.method === "POST" && parsedUrl.pathname === "/api/skills") {
          const body = await readBody(req);
          const name =
            typeof body["name"] === "string" ? body["name"].trim() : "";
          const description =
            typeof body["description"] === "string" ? body["description"] : "";
          const content =
            typeof body["content"] === "string" ? body["content"] : "";
          if (!SKILL_NAME_RE.test(name)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid skill name" }));
            return;
          }
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveSkillsDir(scope, repoId);
          const existing = await readSkill(dir, name);
          if (existing !== null) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Skill already exists" }));
            return;
          }
          const skill: Skill = { name, description, content };
          await writeSkill(dir, skill);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify(skill));
          return;
        }

        // PUT /api/skills/:name
        if (
          req.method === "PUT" &&
          parsedUrl.pathname?.startsWith("/api/skills/") &&
          parsedUrl.pathname !== "/api/skills/"
        ) {
          const name = parsedUrl.pathname.slice("/api/skills/".length);
          if (!SKILL_NAME_RE.test(name)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid skill name" }));
            return;
          }
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveSkillsDir(scope, repoId);
          const existing = await readSkill(dir, name);
          if (existing === null) {
            res.writeHead(404);
            res.end();
            return;
          }
          const body = await readBody(req);
          const description =
            typeof body["description"] === "string"
              ? body["description"]
              : existing.description;
          const content =
            typeof body["content"] === "string"
              ? body["content"]
              : existing.content;
          const skill: Skill = { name, description, content };
          await writeSkill(dir, skill);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(skill));
          return;
        }

        // DELETE /api/skills/:name
        if (
          req.method === "DELETE" &&
          parsedUrl.pathname?.startsWith("/api/skills/") &&
          parsedUrl.pathname !== "/api/skills/"
        ) {
          const name = parsedUrl.pathname.slice("/api/skills/".length);
          if (!SKILL_NAME_RE.test(name)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid skill name" }));
            return;
          }
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveSkillsDir(scope, repoId);
          const existing = await readSkill(dir, name);
          if (existing === null) {
            res.writeHead(404);
            res.end();
            return;
          }
          await deleteSkill(dir, name);
          res.writeHead(204);
          res.end();
          return;
        }

        // GET /api/agents
        if (req.method === "GET" && parsedUrl.pathname === "/api/agents") {
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveAgentsDir(scope, repoId);
          const agents = await listAgents(dir);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ agents }));
          return;
        }

        // GET /api/agents/:name
        if (
          req.method === "GET" &&
          parsedUrl.pathname?.startsWith("/api/agents/") &&
          parsedUrl.pathname !== "/api/agents/"
        ) {
          const name = parsedUrl.pathname.slice("/api/agents/".length);
          if (!AGENT_NAME_RE.test(name)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid agent name" }));
            return;
          }
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveAgentsDir(scope, repoId);
          const agent = await readAgent(dir, name);
          if (agent === null) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(agent));
          return;
        }

        // POST /api/agents
        if (req.method === "POST" && parsedUrl.pathname === "/api/agents") {
          const body = await readBody(req);
          const name =
            typeof body["name"] === "string" ? body["name"].trim() : "";
          const description =
            typeof body["description"] === "string" ? body["description"] : "";
          const content =
            typeof body["content"] === "string" ? body["content"] : "";
          if (!AGENT_NAME_RE.test(name)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid agent name" }));
            return;
          }
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveAgentsDir(scope, repoId);
          const existing = await readAgent(dir, name);
          if (existing !== null) {
            res.writeHead(409, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Agent already exists" }));
            return;
          }
          const agent: Agent = { name, description, content };
          await writeAgent(dir, agent);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify(agent));
          return;
        }

        // PUT /api/agents/:name
        if (
          req.method === "PUT" &&
          parsedUrl.pathname?.startsWith("/api/agents/") &&
          parsedUrl.pathname !== "/api/agents/"
        ) {
          const name = parsedUrl.pathname.slice("/api/agents/".length);
          if (!AGENT_NAME_RE.test(name)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid agent name" }));
            return;
          }
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveAgentsDir(scope, repoId);
          const existing = await readAgent(dir, name);
          if (existing === null) {
            res.writeHead(404);
            res.end();
            return;
          }
          const body = await readBody(req);
          const description =
            typeof body["description"] === "string"
              ? body["description"]
              : existing.description;
          const content =
            typeof body["content"] === "string"
              ? body["content"]
              : existing.content;
          const agent: Agent = { name, description, content };
          await writeAgent(dir, agent);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(agent));
          return;
        }

        // DELETE /api/agents/:name
        if (
          req.method === "DELETE" &&
          parsedUrl.pathname?.startsWith("/api/agents/") &&
          parsedUrl.pathname !== "/api/agents/"
        ) {
          const name = parsedUrl.pathname.slice("/api/agents/".length);
          if (!AGENT_NAME_RE.test(name)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid agent name" }));
            return;
          }
          const scope =
            typeof parsedUrl.query["scope"] === "string"
              ? parsedUrl.query["scope"]
              : "global";
          const repoId =
            typeof parsedUrl.query["repoId"] === "string"
              ? parsedUrl.query["repoId"]
              : null;
          const dir = await resolveAgentsDir(scope, repoId);
          const existing = await readAgent(dir, name);
          if (existing === null) {
            res.writeHead(404);
            res.end();
            return;
          }
          await deleteAgent(dir, name);
          res.writeHead(204);
          res.end();
          return;
        }

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
          const name =
            typeof body["name"] === "string" ? body["name"].trim() : "";
          const path =
            typeof body["path"] === "string" ? body["path"].trim() : "";
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
          if (typeof body["path"] === "string" && !existsSync(body["path"])) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: `Path does not exist: ${body["path"]}`,
              }),
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

        void handle(req, res, parsedUrl);
      } catch (err) {
        console.error("Request error:", err);
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });

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
        // Reconnect: attach this WS, replay buffer, resync status
        entry.activeWs = ws;
        if (entry.outputBuffer.length > 0) {
          const replay = Buffer.concat(entry.outputBuffer);
          ws.send(
            JSON.stringify({ type: "replay", data: replay.toString("base64") }),
          );
        }
        emitStatus(ws, entry.currentStatus);
      } else {
        // New or resumed session: spawn pty
        const registryEntry = sessionRegistry.get(sessionId);
        const sessionCwd = registryEntry?.cwd ?? process.cwd();
        const spawnArgs = registryEntry
          ? ["--dangerously-skip-permissions", "--continue"]
          : ["--dangerously-skip-permissions"];

        let ptyProcess: pty.IPty;
        try {
          ptyProcess = pty.spawn(command, spawnArgs, {
            name: "xterm-color",
            cols: 80,
            rows: 24,
            cwd: sessionCwd,
            env: process.env as Record<string, string>,
          });
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: String(err) }));
          ws.close();
          return;
        }

        // Track in registry so the session survives future server restarts
        if (!registryEntry) {
          sessionRegistry.set(sessionId, {
            id: sessionId,
            cwd: process.cwd(),
            createdAt: new Date().toISOString(),
          });
          void saveSessionRegistry();
        }

        entry = {
          pty: ptyProcess,
          outputBuffer: [],
          bufferSize: 0,
          activeWs: ws,
          currentStatus: "connecting",
          handoverPhase: null,
          handoverSpec: "",
          specSentAt: 0,
          hadMeaningfulActivity: false,
        };
        sessions.set(sessionId, entry);
        emitStatus(ws, "connecting");

        ptyProcess.onData((data) => {
          const chunk = Buffer.from(data);
          const e = sessions.get(sessionId)!;
          appendToBuffer(e, chunk);
          if (e.activeWs?.readyState === WebSocket.OPEN) {
            e.activeWs.send(chunk);
          }

          const parsed = parseClaudeStatus(data);
          if (parsed !== null && parsed !== e.currentStatus) {
            e.currentStatus = parsed;
            emitStatus(e.activeWs, parsed);
          }
        });

        ptyProcess.onExit(({ exitCode }) => {
          const e = sessions.get(sessionId);
          if (e) {
            e.currentStatus = "exited";
            if (e.activeWs?.readyState === WebSocket.OPEN) {
              e.activeWs.send(JSON.stringify({ type: "exit", code: exitCode }));
              e.activeWs.close();
            }
          }
          sessions.delete(sessionId);
        });
      }

      ws.on("message", (data, isBinary) => {
        const e = sessions.get(sessionId);
        if (!e) {
          return;
        }
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
