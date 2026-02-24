import { WebSocket } from "ws";

import type { Task } from "./tasks.types.js";

type BoardMessage =
  | { type: "task_created"; task: Task }
  | { type: "task_updated"; task: Task }
  | { type: "task_deleted"; taskId: string }
  | { type: "snapshot"; tasks: Task[] };

const boardClients = new Set<WebSocket>();

export function addBoardClient(ws: WebSocket): void {
  boardClients.add(ws);
  ws.on("close", () => {
    boardClients.delete(ws);
  });
}

export function broadcast(message: BoardMessage): void {
  const payload = JSON.stringify(message);
  for (const client of boardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
