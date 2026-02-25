import type { ClaudeStatus } from "@/hooks/useTerminalSocket.types";

import styles from "./StatusIndicator.module.css";
import type { StatusIndicatorProps } from "./StatusIndicator.types";

const LABELS: Record<ClaudeStatus, string> = {
  connecting: "Connecting",
  thinking: "Thinking",
  typing: "Typing",
  waiting: "Waiting",
  exited: "Exited",
  disconnected: "Disconnected",
};

export const StatusIndicator = ({ status }: StatusIndicatorProps) => (
  <span
    className={`${styles.root} ${styles[status]}`}
    role="status"
    aria-label={`Claude status: ${LABELS[status]}`}
  >
    <span className={styles.dot} aria-hidden="true" />
    <span className={styles.label}>{LABELS[status]}</span>
  </span>
);
