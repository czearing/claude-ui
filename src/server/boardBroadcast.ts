import { WebSocket } from "ws";

export const boardClients = new Set<WebSocket>();

export function broadcastTaskEvent(event: string, data: unknown): void {
  const message = JSON.stringify({ type: event, data });
  boardClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
