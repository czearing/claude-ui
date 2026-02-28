// src/hooks/useTasksSocket.ts
"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useNotifications } from "@/context/NotificationContext";
import { tasksKey } from "@/hooks/useTasks";
import type { Task } from "@/utils/tasks.types";

type TaskEvent =
  | { type: "task:created"; data: Task }
  | { type: "task:updated"; data: Task }
  | { type: "task:deleted"; data: { id: string; repo?: string } }
  | { type: "repo:created" | "repo:deleted"; data: unknown };

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export function useTasksSocket() {
  const queryClient = useQueryClient();

  const { notifyTransition } = useNotifications();
  const notifyRef = useRef(notifyTransition);
  notifyRef.current = notifyTransition;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let dead = false; // set true on unmount to prevent reconnection
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/board`);

      ws.onopen = () => {
        const wasReconnect = attempt > 0;
        attempt = 0; // reset backoff on successful connection
        // Only catch up on missed events when this is a reconnect, not the
        // initial connection (which would discard any optimistic cache updates).
        if (wasReconnect) {
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as TaskEvent;

          if (msg.type === "task:updated") {
            // Detect status change before updating cache
            const cached = queryClient.getQueryData<Task[]>(
              tasksKey(msg.data.repo),
            );
            const prevTask = cached?.find((t) => t.id === msg.data.id);
            if (prevTask && prevTask.status !== msg.data.status) {
              notifyRef.current(msg.data, prevTask.status, msg.data.status);
            }

            queryClient.setQueryData<Task[]>(
              tasksKey(msg.data.repo),
              (prev) => {
                if (!prev) {
                  return prev;
                }
                return prev.map((t) => (t.id === msg.data.id ? msg.data : t));
              },
            );
          } else if (msg.type === "task:created") {
            queryClient.setQueryData<Task[]>(
              tasksKey(msg.data.repo),
              (prev) => {
                if (!prev) {
                  return prev;
                }
                return [...prev, msg.data];
              },
            );
          } else if (msg.type === "task:deleted") {
            if (msg.data.repo) {
              queryClient.setQueryData<Task[]>(
                tasksKey(msg.data.repo),
                (prev) => {
                  if (!prev) {
                    return prev;
                  }
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
        if (dead) {
          return;
        }
        const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      dead = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      ws?.close();
    };
  }, [queryClient]);
}
