"use client";

import { useEffect, useRef, useState } from "react";

import { useChatSession } from "@/hooks/useChatSession";
import type { ClaudeStatus } from "@/hooks/useChatStream.types";
import type { Task } from "@/utils/tasks.types";
import { ChatMessages } from "./ChatMessages";
import styles from "./ChatPanel.module.css";

interface ChatPanelProps {
  task: Task;
  onClose: () => void;
}

function getStatusInfo(
  task: Task,
  status: ClaudeStatus,
  busy: boolean,
): { dot: string; label: string | null } {
  if (busy) {
    const labels: Partial<Record<ClaudeStatus, string>> = {
      connecting: "Connecting…",
      thinking: "Thinking…",
      typing: "Typing…",
    };
    return { dot: "in-progress", label: labels[status] ?? null };
  }
  if (task.status === "Review") {
    return { dot: "review", label: null };
  }
  if (task.status === "In Progress") {
    return { dot: "in-progress", label: null };
  }
  return { dot: "idle", label: null };
}

export function ChatPanel({ task, onClose }: ChatPanelProps) {
  const { messages, status, ready, taskRunning, error, sendMessage, retry } =
    useChatSession(task);
  const [inputValue, setInputValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const busy =
    status === "connecting" || status === "thinking" || status === "typing";

  const { dot, label } = getStatusInfo(task, status, busy);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const text = inputValue.trim();
    if (!text || taskRunning || !ready) {
      return;
    }
    sendMessage(text);
    setInputValue("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter or Ctrl+Enter sends; Shift+Enter inserts a newline
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className={styles.panel} data-testid="chat-panel">
      <div className={styles.header}>
        <span
          className={styles.statusDot}
          data-status={dot}
          aria-hidden="true"
        />
        <span className={styles.title}>{task.title || "Untitled"}</span>
        {label && <span className={styles.statusLabel}>{label}</span>}
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close chat panel"
        >
          &#x2715;
        </button>
      </div>

      <div className={styles.messages}>
        {!ready ? (
          <div className={styles.loading}>
            <div className={styles.dots} aria-label="Loading" role="status">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : (
          <>
            <ChatMessages messages={messages} onSendMessage={sendMessage} />
            {taskRunning && (
              <div
                className={styles.thinkingBubble}
                aria-label="Claude is thinking"
                role="status"
              >
                <div className={styles.dots}>
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className={styles.errorBar}>
          <span className={styles.errorMsg}>{error}</span>
          <button className={styles.retryBtn} onClick={retry}>
            Retry
          </button>
        </div>
      )}

      <div className={styles.footer}>
        <div className={styles.footerRow}>
          <textarea
            ref={inputRef}
            className={styles.input}
            value={inputValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              !ready
                ? "Connecting…"
                : taskRunning
                  ? "Claude is responding…"
                  : "Type a message…"
            }
            disabled={!ready || taskRunning}
            rows={1}
            aria-label="Chat message input"
          />
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={taskRunning || !ready || !inputValue.trim()}
            aria-label="Send message"
          >
            ↑
          </button>
        </div>
        {ready && (
          <span className={styles.hint}>
            Enter or Ctrl+Enter to send · Shift+Enter for new line
          </span>
        )}
      </div>
    </div>
  );
}
