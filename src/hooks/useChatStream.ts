"use client";

import { useEffect, useRef, useState } from "react";

import { parseStreamEvent, readNdjsonStream } from "./chatStreamUtils";
import type { ClaudeStatus, Message } from "./useChatStream.types";

export function useChatStream(
  taskId: string,
  onStatus: (s: ClaudeStatus) => void,
): { messages: Message[]; sessionId: string } {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState("");
  const onStatusRef = useRef(onStatus);

  useEffect(() => {
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    if (!taskId) {
      return;
    }

    const ac = new AbortController();

    function handleChunk(events: Record<string, unknown>[]) {
      const newMessages: Message[] = [];
      for (const event of events) {
        for (const action of parseStreamEvent(event)) {
          if (action.op === "status") {
            onStatusRef.current(action.status);
          } else if (action.op === "addMessages") {
            newMessages.push(...action.messages);
          } else if (action.op === "sessionId") {
            setSessionId(action.id);
          }
        }
      }
      if (newMessages.length > 0) {
        setMessages((prev) => [...prev, ...newMessages]);
      }
    }

    async function run() {
      onStatusRef.current("connecting");
      let res: Response;
      try {
        res = await fetch(`/api/tasks/${taskId}/handover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: ac.signal,
        });
      } catch {
        return;
      }
      if (ac.signal.aborted || !res.body) {
        return;
      }
      await readNdjsonStream(res, ac.signal, handleChunk);
    }

    void run();

    return () => {
      ac.abort();
    };
  }, [taskId]);

  return { messages, sessionId };
}
