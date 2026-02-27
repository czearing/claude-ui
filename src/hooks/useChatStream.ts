"use client";

import { useEffect, useRef, useState } from "react";

import type { ClaudeStatus, Message } from "./useChatStream.types";

let _msgCounter = 0;
function nextId() {
  return `msg-${++_msgCounter}`;
}

function extractToolResultText(
  content: string | { type: string; text: string }[],
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

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

    let cancelled = false;

    async function run() {
      onStatusRef.current("connecting");

      let res: Response;
      try {
        res = await fetch(`/api/tasks/${taskId}/handover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      } catch {
        return;
      }

      if (cancelled || !res.body) {
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!cancelled) {
        let done: boolean;
        let value: Uint8Array | undefined;
        try {
          ({ done, value } = await reader.read());
        } catch {
          break;
        }
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            continue;
          }
          handleEvent(event);
        }
      }
    }

    function handleEvent(event: Record<string, unknown>) {
      const type = event.type as string;
      const subtype = event.subtype as string | undefined;

      if (type === "system" && subtype === "init") {
        const sid = event.session_id as string | undefined;
        if (sid) {
          setSessionId(sid);
        }
        onStatusRef.current("thinking");
        return;
      }

      if (type === "assistant") {
        onStatusRef.current("typing");
        const msg = event.message as
          | {
              content?: {
                type: string;
                text?: string;
                name?: string;
                id?: string;
              }[];
            }
          | undefined;
        if (!msg?.content) {
          return;
        }
        setMessages((prev) => {
          const next = [...prev];
          for (const block of msg.content ?? []) {
            if (block.type === "text" && block.text) {
              next.push({
                id: nextId(),
                role: "assistant",
                content: block.text,
              });
            } else if (block.type === "tool_use") {
              next.push({
                id: nextId(),
                role: "tool",
                content: "",
                toolName: block.name ?? "tool",
              });
            }
          }
          return next;
        });
        return;
      }

      if (type === "user") {
        const msg = event.message as
          | {
              content?: {
                type: string;
                tool_use_id?: string;
                content?: unknown;
              }[];
            }
          | undefined;
        if (!msg?.content) {
          return;
        }
        setMessages((prev) => {
          const next = [...prev];
          for (const block of msg.content ?? []) {
            if (block.type === "tool_result") {
              const raw = block.content as
                | string
                | { type: string; text: string }[]
                | undefined;
              const text = raw != null ? extractToolResultText(raw) : "";
              next.push({
                id: nextId(),
                role: "system",
                content: text,
              });
            }
          }
          return next;
        });
        onStatusRef.current("thinking");
        return;
      }

      if (type === "result") {
        onStatusRef.current("done");
        return;
      }

      if (type === "done") {
        onStatusRef.current("idle");
        return;
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  return { messages, sessionId };
}
