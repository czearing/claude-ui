import { useState } from "react";

import type { Message } from "@/hooks/useChatStream.types";
import styles from "./ChatMessages.module.css";
import { ChoicePrompt } from "./ChoicePrompt";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatMessagesProps {
  messages: Message[];
  onSendMessage?: (message: string) => void;
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
}: ChatMessagesProps) {
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyText}>
          No messages yet — ask Claude anything about this task.
        </span>
      </div>
    );
  }

  const grouped = groupMessages(messages);

  return (
    <div className={styles.list}>
      {grouped.map((item) => {
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
          return (
            <div key={msg.id} className={styles.systemCard}>
              <pre className={styles.systemPre}>{msg.content}</pre>
            </div>
          );
        }

        if (msg.role === "assistant") {
          if (msg.options?.length) {
            return (
              <ChoicePrompt
                key={msg.id}
                messageId={msg.id}
                question={msg.content}
                options={msg.options}
                answered={answeredIds.has(msg.id)}
                onAnswer={(value) => {
                  setAnsweredIds((prev) => new Set([...prev, msg.id]));
                  onSendMessage(value);
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
