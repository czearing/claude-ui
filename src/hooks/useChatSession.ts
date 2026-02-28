"use client";

import { useEffect, useRef, useState } from "react";

import type { Task } from "@/utils/tasks.types";
import { parseStreamEvent, readNdjsonStream } from "./chatStreamUtils";
import type { ClaudeStatus, Message } from "./useChatStream.types";

const BACKLOG_RETRY_ATTEMPTS = 3;
const BACKLOG_RETRY_DELAY_MS = 1500;

export function useChatSession(task: Task): {
  messages: Message[];
  status: ClaudeStatus;
  ready: boolean;
  taskRunning: boolean;
  error: string | null;
  sendMessage: (text: string) => void;
  sendAnswer: (answer: string) => void;
  retry: () => void;
} {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<ClaudeStatus>("idle");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const taskIdRef = useRef(task.id);
  const abortRef = useRef<AbortController | null>(null);
  // Track the claudeSessionId we last loaded so auto-refresh knows when it changed
  const loadedSessionRef = useRef<string | undefined>(undefined);

  // taskRunning: input should be locked — either actively streaming OR the task
  // is still "In Progress" in the store (e.g. user navigated away mid-run and returned).
  const taskRunning =
    task.status === "In Progress" ||
    status === "connecting" ||
    status === "thinking" ||
    status === "typing";

  function handleChunk(events: Record<string, unknown>[]) {
    const newMessages: Message[] = [];
    for (const event of events) {
      for (const action of parseStreamEvent(event)) {
        if (action.op === "status") {
          setStatus(action.status);
        } else if (action.op === "addMessages") {
          newMessages.push(...action.messages);
        }
      }
    }
    if (newMessages.length > 0) {
      setMessages((prev) => [...prev, ...newMessages]);
    }
  }

  async function fetchHistory(
    taskId: string,
    signal: AbortSignal,
  ): Promise<Message[] | null> {
    try {
      const res = await fetch(`/api/tasks/${taskId}/history`, { signal });
      if (!signal.aborted && res.ok) {
        return (await res.json()) as Message[];
      }
    } catch {
      // aborted or network error
    }
    return null;
  }

  useEffect(() => {
    taskIdRef.current = task.id;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    setMessages([]);
    setStatus("idle");
    setReady(false);
    setError(null);

    const taskId = task.id;
    const hasSession = Boolean(task.claudeSessionId);
    const isBacklog = task.status === "Backlog";

    const ac = new AbortController();
    abortRef.current = ac;

    async function init() {
      if (hasSession) {
        // Mark which session we're loading so the auto-refresh effect skips it
        loadedSessionRef.current = task.claudeSessionId;
        try {
          const res = await fetch(`/api/tasks/${taskId}/history`, {
            signal: ac.signal,
          });
          if (!ac.signal.aborted) {
            if (res.ok) {
              const history = (await res.json()) as Message[];
              if (!ac.signal.aborted) {
                setMessages(history);
              }
            } else {
              setError(`Failed to load history (${res.status}).`);
            }
          }
        } catch {
          if (!ac.signal.aborted) {
            setError("Failed to connect. Check your connection.");
          }
        }
        if (!ac.signal.aborted) {
          setStatus("idle");
          setReady(true);
        }
      } else if (isBacklog) {
        setStatus("connecting");
        let gotIdle = false;

        for (let attempt = 0; attempt < BACKLOG_RETRY_ATTEMPTS; attempt++) {
          if (ac.signal.aborted) {
            return;
          }
          if (attempt > 0) {
            // Wait before retrying
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, BACKLOG_RETRY_DELAY_MS);
              ac.signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(t);
                  resolve();
                },
                { once: true },
              );
            });
            if (ac.signal.aborted) {
              return;
            }
          }

          let res: Response;
          try {
            res = await fetch(`/api/tasks/${taskId}/handover`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
              signal: ac.signal,
            });
          } catch {
            if (!ac.signal.aborted && attempt === BACKLOG_RETRY_ATTEMPTS - 1) {
              setError("Failed to connect. Check your connection.");
              setStatus("idle");
              setReady(true);
            }
            continue;
          }
          if (ac.signal.aborted) {
            return;
          }
          if (!res.ok) {
            if (attempt === BACKLOG_RETRY_ATTEMPTS - 1) {
              setError(`Server error (${res.status}).`);
              setStatus("idle");
              setReady(true);
            }
            continue;
          }

          // Track whether we received an "idle" done event
          let streamEndedWithIdle = false;
          const wrappedHandleChunk = (events: Record<string, unknown>[]) => {
            handleChunk(events);
            if (events.some((e) => e.type === "done")) {
              streamEndedWithIdle = true;
            }
          };

          await readNdjsonStream(res, ac.signal, wrappedHandleChunk);

          if (ac.signal.aborted) {
            return;
          }

          if (streamEndedWithIdle) {
            gotIdle = true;
            break;
          }

          // Stream dropped unexpectedly — restore from history before retrying
          const history = await fetchHistory(taskId, ac.signal);
          if (ac.signal.aborted) {
            return;
          }
          if (history) {
            setMessages(history);
          }
          setStatus("connecting");
        }

        if (!ac.signal.aborted) {
          if (!gotIdle) {
            // All retry attempts exhausted — restore latest history and give up
            const history = await fetchHistory(taskId, ac.signal);
            if (!ac.signal.aborted && history) {
              setMessages(history);
            }
          }
          setStatus("idle");
          setReady(true);
        }
      } else {
        setStatus("idle");
        setReady(true);

        // Task is running in the background (In Progress, no session yet).
        // Poll history so incremental output becomes visible.
        if (task.status === "In Progress") {
          const poll = async () => {
            if (ac.signal.aborted) {
              return;
            }
            const history = await fetchHistory(taskId, ac.signal);
            if (!ac.signal.aborted && history && history.length > 0) {
              setMessages(history);
            }
          };
          const intervalId = setInterval(() => {
            void poll();
          }, 2000);
          ac.signal.addEventListener("abort", () => clearInterval(intervalId), {
            once: true,
          });
        }
      }
    }

    void init();

    return () => {
      ac.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, retryKey]);

  // When Claude finishes a session the board broadcasts task:updated with a new
  // claudeSessionId. Re-fetch history so the panel shows the full conversation
  // without requiring a page reload.
  useEffect(() => {
    if (
      !task.claudeSessionId ||
      task.claudeSessionId === loadedSessionRef.current
    ) {
      return;
    }
    const ac = new AbortController();
    async function refresh() {
      try {
        const res = await fetch(`/api/tasks/${task.id}/history`, {
          signal: ac.signal,
        });
        if (!ac.signal.aborted && res.ok) {
          const history = (await res.json()) as Message[];
          if (!ac.signal.aborted) {
            setMessages(history);
            loadedSessionRef.current = task.claudeSessionId;
          }
        }
      } catch {
        // aborted or network error — main error handling covers user-visible cases
      }
    }
    void refresh();
    return () => ac.abort();
  }, [task.id, task.claudeSessionId]);

  function sendMessage(text: string) {
    if (!text.trim()) {
      return;
    }

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text },
    ]);
    setError(null);

    const taskId = taskIdRef.current;

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("connecting");

    async function stream() {
      let res: Response;
      try {
        res = await fetch(`/api/tasks/${taskId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
          signal: ac.signal,
        });
      } catch {
        if (!ac.signal.aborted) {
          setError("Failed to send. Check your connection.");
          setStatus("idle");
        }
        return;
      }
      if (ac.signal.aborted) {
        return;
      }
      if (!res.ok) {
        setError(`Server error (${res.status}).`);
        setStatus("idle");
        return;
      }

      let streamEndedWithIdle = false;
      const wrappedHandleChunk = (events: Record<string, unknown>[]) => {
        handleChunk(events);
        if (events.some((e) => e.type === "done")) {
          streamEndedWithIdle = true;
        }
      };

      await readNdjsonStream(res, ac.signal, wrappedHandleChunk);

      if (!ac.signal.aborted) {
        if (!streamEndedWithIdle) {
          // Stream dropped unexpectedly — restore from history to get full state
          const history = await fetchHistory(taskId, ac.signal);
          if (!ac.signal.aborted && history) {
            setMessages(history);
          }
        }
        setStatus("idle");
      }
    }

    void stream();
  }

  /**
   * Write an AskUserQuestion answer directly to the active PTY stdin.
   * Only called when the task is currently running (interactive mode).
   * Falls back to sendMessage if no active PTY is found (e.g. task finished).
   */
  function sendAnswer(answer: string) {
    const taskId = taskIdRef.current;
    void fetch(`/api/tasks/${taskId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    }).then((res) => {
      if (res.ok) {
        // PTY received the answer — show it as a local user message.
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", content: answer },
        ]);
      } else {
        // No active PTY (task already finished) — fall back to chat.
        sendMessage(answer);
      }
    }).catch(() => {
      sendMessage(answer);
    });
  }

  function retry() {
    setRetryKey((k) => k + 1);
  }

  return {
    messages,
    status,
    ready,
    taskRunning,
    error,
    sendMessage,
    sendAnswer,
    retry,
  };
}
