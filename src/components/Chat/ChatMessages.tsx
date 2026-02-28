import { useState } from "react";

import type { Message } from "@/hooks/useChatStream.types";
import styles from "./ChatMessages.module.css";
import { ChoicePrompt } from "./ChoicePrompt";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatMessagesProps {
  messages: Message[];
  onSendMessage?: (message: string) => void;
  // Called instead of onSendMessage when the task is running and the user
  // answers an AskUserQuestion — writes directly to PTY stdin so Claude
  // pauses and waits rather than auto-rejecting.
  onAnswerQuestion?: (answer: string) => void;
  taskRunning?: boolean;
}

// ---------------------------------------------------------------------------
// Tool result card (groups a tool-call + its result into one collapsible card)
// ---------------------------------------------------------------------------

const COLLAPSE_THRESHOLD = 300;

function ToolResultCard({ tool, result }: { tool: Message; result: Message }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = result.content.length > COLLAPSE_THRESHOLD;
  const displayContent =
    isLong && !expanded
      ? `${result.content.slice(0, COLLAPSE_THRESHOLD)}…`
      : result.content;

  return (
    <div className={styles.toolCard}>
      <div className={styles.toolHeader}>
        <span className={styles.toolLabel}>{tool.toolName ?? "tool"}</span>
      </div>
      {result.content && (
        <>
          <pre className={styles.toolResultPre}>{displayContent}</pre>
          {isLong && (
            <button
              className={styles.toggleBtn}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message grouping (pairs consecutive tool-call + system/tool-result messages)
// ---------------------------------------------------------------------------

type GroupedItem =
  | { kind: "message"; msg: Message }
  | { kind: "tool-pair"; tool: Message; result: Message }
  | { kind: "tool-pending"; tool: Message };

function groupMessages(messages: Message[]): GroupedItem[] {
  const items: GroupedItem[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (
      msg.role === "tool" &&
      i + 1 < messages.length &&
      messages[i + 1].role === "system"
    ) {
      items.push({ kind: "tool-pair", tool: msg, result: messages[i + 1] });
      i += 2;
    } else if (msg.role === "tool") {
      items.push({ kind: "tool-pending", tool: msg });
      i++;
    } else {
      items.push({ kind: "message", msg });
      i++;
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// ChatMessages
// ---------------------------------------------------------------------------

export function ChatMessages({
  messages,
  onSendMessage = () => {},
  onAnswerQuestion,
  taskRunning = false,
}: ChatMessagesProps) {
  const [answeredValues, setAnsweredValues] = useState<Map<string, string>>(
    new Map(),
  );

  if (messages.length === 0) {
    if (taskRunning) {
      return null;
    }
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>
          Send a task to get started.
        </span>
      </div>
    );
  }

  const grouped = groupMessages(messages);

  return (
    <div className={styles.list}>
      {grouped.map((item, idx) => {
        if (item.kind === "tool-pair") {
          return (
            <ToolResultCard
              key={item.tool.id}
              tool={item.tool}
              result={item.result}
            />
          );
        }

        if (item.kind === "tool-pending") {
          return (
            <div key={item.tool.id} className={styles.toolCard}>
              <div className={styles.toolHeader}>
                <span className={styles.toolLabel}>
                  {item.tool.toolName ?? "tool"}
                </span>
              </div>
            </div>
          );
        }

        const { msg } = item;

        if (msg.role === "system") {
          // If the previous grouped item was a ChoicePrompt, this system message
          // is its tool_result (the answer). Skip rendering it — the chip inside
          // ChoicePrompt already shows the chosen value.
          const prev = grouped[idx - 1];
          if (
            prev?.kind === "message" &&
            prev.msg.role === "assistant" &&
            prev.msg.options?.length
          ) {
            return null;
          }
          return (
            <div key={msg.id} className={styles.systemCard}>
              <pre className={styles.systemPre}>{msg.content}</pre>
            </div>
          );
        }

        if (msg.role === "assistant") {
          if (msg.options?.length) {
            // Derive answered state from either a user click OR a subsequent
            // system message (tool_result already in history from terminal).
            // Only treat the next system message as a real answer if its
            // content matches one of the known option labels. The PTY
            // auto-rejection message ("Answer questions?") will not match any
            // label and is therefore ignored.
            const nextItem = grouped[idx + 1];
            const nextSystemContent =
              nextItem?.kind === "message" &&
              nextItem.msg.role === "system"
                ? nextItem.msg.content
                : null;
            const contextAnswer =
              nextSystemContent !== null &&
              msg.options?.some((opt) => opt.label === nextSystemContent)
                ? nextSystemContent
                : null;
            const answeredValue =
              answeredValues.get(msg.id) ?? contextAnswer;
            return (
              <ChoicePrompt
                key={msg.id}
                messageId={msg.id}
                question={msg.content}
                options={msg.options}
                answeredValue={answeredValue}
                onAnswer={(value) => {
                  setAnsweredValues(
                    (prev) => new Map(prev).set(msg.id, value),
                  );
                  // When task is running, write the answer to PTY stdin so
                  // Claude receives it directly. When not running, spawn a
                  // new session via the chat endpoint.
                  if (taskRunning && onAnswerQuestion) {
                    onAnswerQuestion(value);
                  } else {
                    onSendMessage(value);
                  }
                }}
              />
            );
          }
          return (
            <div key={msg.id} className={styles.assistantBubble}>
              <MarkdownRenderer
                content={msg.content}
                className={styles.bubbleText}
              />
            </div>
          );
        }

        // user role
        return (
          <div key={msg.id} className={styles.userBubble}>
            <p className={styles.bubbleText}>{msg.content}</p>
          </div>
        );
      })}
    </div>
  );
}
