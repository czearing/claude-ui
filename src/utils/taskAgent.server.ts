import * as pty from "node-pty";

import { broadcast } from "./boardBroadcast.server.js";
import { updateTask } from "./tasks.server.js";

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const command = process.platform === "win32" ? "claude.cmd" : "claude";
const PROGRESS_RE = /^(Reading|Writing|Running|Editing|Executing)\s/i;
const LOG_DIR = resolve(process.cwd(), "task-logs");

export async function spawnAgent(taskId: string): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
  const logPath = resolve(LOG_DIR, `${taskId}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });

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
    const errMsg = String(err);
    const failed = updateTask(taskId, { errorMessage: errMsg, agentPid: undefined });
    if (failed) {
      broadcast({ type: "task_updated", task: failed });
    }
    logStream.end();
    return;
  }

  const started = updateTask(taskId, {
    status: "in_progress",
    startedAt: new Date().toISOString(),
    agentPid: ptyProcess.pid,
  });
  if (started) {
    broadcast({ type: "task_updated", task: started });
  }

  ptyProcess.onData((data) => {
    logStream.write(data);
    const line = data.trim();
    if (PROGRESS_RE.test(line)) {
      const task = updateTask(taskId, { currentAction: line });
      if (task) {
        broadcast({ type: "task_updated", task });
      }
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    logStream.end();
    if (exitCode === 0) {
      const done = updateTask(taskId, {
        status: "review",
        completedAt: new Date().toISOString(),
        agentPid: undefined,
        currentAction: undefined,
      });
      if (done) {
        broadcast({ type: "task_updated", task: done });
      }
    } else {
      const failed = updateTask(taskId, {
        errorMessage: `Agent exited with code ${exitCode}`,
        agentPid: undefined,
        currentAction: undefined,
      });
      if (failed) {
        broadcast({ type: "task_updated", task: failed });
      }
    }
  });
}
