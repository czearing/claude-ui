"use client";

import { useRef } from "react";

/**
 * Keeps a PTY connection alive in the background (no UI) so Claude keeps
 * running when the spec editor closes in Tasks view.
 */
export function useBackgroundHandover(): (taskId: string) => void {
  const bgHandoversRef = useRef<Map<string, AbortController>>(new Map());

  return (taskId: string) => {
    if (bgHandoversRef.current.has(taskId)) {
      return;
    }

    const ac = new AbortController();
    bgHandoversRef.current.set(taskId, ac);

    async function run() {
      try {
        const res = await fetch(`/api/tasks/${taskId}/handover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: ac.signal,
        });
        if (!res.body) {
          return;
        }
        const reader = res.body.getReader();
        while (!ac.signal.aborted) {
          const { done } = await reader.read();
          if (done) {
            break;
          }
        }
      } catch {
        // aborted or network error — Claude process was already killed or finished
      } finally {
        bgHandoversRef.current.delete(taskId);
      }
    }

    void run();
  };
}
