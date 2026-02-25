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
        } else if (msg.type === "repo:created" || msg.type === "repo:deleted") {
          void queryClient.invalidateQueries({ queryKey: ["repos"] });
        }
      } catch {
        // ignore non-JSON messages
      }
    };

    return () => ws.close();
  }, [queryClient]);
}
