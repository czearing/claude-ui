"use client";

import { useRef, useEffect } from "react";

import { ChatMessages } from "@/components/Chat/ChatMessages";
import { useChatStream } from "@/hooks/useChatStream";
import type { ClaudeStatus } from "@/hooks/useChatStream.types";
import styles from "./ChatPage.module.css";

type ChatPageProps = {
  taskId: string;
  onStatus?: (status: ClaudeStatus) => void;
};

function Dots() {
  return (
    <div className={styles.dots} aria-label="Loading" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

export function ChatPage({ taskId, onStatus }: ChatPageProps) {
  const { messages, sessionId: streamSessionId } = useChatStream(
    taskId,
    onStatus ?? (() => {}),
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const isStreaming = streamSessionId === "" && messages.length === 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className={styles.page}>
      <div className={styles.messages}>
        <ChatMessages messages={messages} />
        {isStreaming && (
          <div className={styles.dotsWrap}>
            <Dots />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
