import type { Message } from "@/hooks/useChatStream.types";
import styles from "./ChatMessages.module.css";

interface ChatMessagesProps {
  messages: Message[];
}

export function ChatMessages({ messages }: ChatMessagesProps) {
  return (
    <div className={styles.list}>
      {messages.map((msg) => {
        if (msg.role === "tool") {
          return (
            <div key={msg.id} className={styles.toolCard}>
              <span className={styles.toolLabel}>{msg.toolName ?? "tool"}</span>
            </div>
          );
        }
        if (msg.role === "system") {
          return (
            <div key={msg.id} className={styles.systemCard}>
              <pre className={styles.systemPre}>{msg.content}</pre>
            </div>
          );
        }
        if (msg.role === "assistant") {
          return (
            <div key={msg.id} className={styles.assistantBubble}>
              <p className={styles.bubbleText}>{msg.content}</p>
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
