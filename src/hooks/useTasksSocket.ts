// src/hooks/useTasksSocket.ts
"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { Task } from "@/utils/tasks.types";

type TaskEvent =
  | { type: "task:created"; data: Task }
  | { type: "task:updated"; data: Task }
  | { type: "task:deleted"; data: { id: string; repoId?: string } }
  | { type: "repo:created" | "repo:deleted"; data: unknown };

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function useTasksSocket() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let ws: WebSocket | null = null;
    let dead = false; // set true on unmount to prevent reconnection
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/board`);

      ws.onopen = () => {
        attempt = 0; // reset backoff on successful connection
        // Catch up on any events missed while disconnected
        void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as TaskEvent;

          if (msg.type === "task:updated") {
            queryClient.setQueryData<Task[]>(
              ["tasks", msg.data.repoId],
              (prev) => {
                if (!prev) return prev;
                return prev.map((t) => (t.id === msg.data.id ? msg.data : t));
              },
            );
          } else if (msg.type === "task:created") {
            queryClient.setQueryData<Task[]>(
              ["tasks", msg.data.repoId],
              (prev) => {
                if (!prev) return prev;
                return [...prev, msg.data];
              },
            );
          } else if (msg.type === "task:deleted") {
            if (msg.data.repoId) {
              queryClient.setQueryData<Task[]>(
                ["tasks", msg.data.repoId],
                (prev) => {
                  if (!prev) return prev;
                  return prev.filter((t) => t.id !== msg.data.id);
                },
              );
            } else {
              void queryClient.invalidateQueries({ queryKey: ["tasks"] });
            }
          } else if (
            msg.type === "repo:created" ||
            msg.type === "repo:deleted"
          ) {
            void queryClient.invalidateQueries({ queryKey: ["repos"] });
          }
          // Unknown event types are silently ignored
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onerror = () => {
        // Close triggers onclose, which schedules reconnect
        ws?.close();
      };

      ws.onclose = () => {
        if (dead) return;
        const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      dead = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [queryClient]);
}
