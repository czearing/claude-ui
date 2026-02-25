import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowRight,
  Code,
  FileText,
  Kanban,
  User,
  Warning,
} from "@phosphor-icons/react";
import clsx from "clsx";

import type { Priority, Task } from "@/utils/tasks.types";
import type { TaskCardProps } from "./TaskCard.types";
import styles from "./TaskCard.module.css";

const PRIORITY_CLASS: Record<Priority, string> = {
  Low: styles.priorityLow,
  Medium: styles.priorityMedium,
  High: styles.priorityHigh,
  Urgent: styles.priorityUrgent,
};

export function TaskCard({ task, onSelect }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const isAgentActive = task.status === "In Progress";
  const isReview = task.status === "Review";
  const isDone = task.status === "Done";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(task)}
      className={clsx(
        styles.card,
        isDragging && styles.cardDragging,
        isAgentActive && styles.cardAgentActive,
        isDone && styles.cardDone,
      )}
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          {task.type === "Spec" ? (
            <FileText size={16} className={styles.typeIcon} />
          ) : (
            <Code size={16} className={styles.typeIcon} />
          )}
          <span className={clsx(styles.title, isDone && styles.titleDone)}>
            {task.title}
          </span>
        </div>
        {isReview && <span className={styles.reviewBadge}>Review</span>}
      </div>

      {isAgentActive && (
        <div className={styles.agentBadge}>
          <div className={styles.shimmer} />
          <Kanban size={12} />
          <span>Agent Processing...</span>
        </div>
      )}

      <div className={styles.footer}>
        <div className={styles.meta}>
          <span className={styles.taskId}>{task.id}</span>
          <Warning size={14} className={PRIORITY_CLASS[task.priority]} />
        </div>

        {task.sessionId ? (
          <a
            href={`/session/${task.sessionId}`}
            className={styles.sessionLink}
            onClick={(e) => e.stopPropagation()}
          >
            <span>Terminal</span>
            <ArrowRight size={10} />
          </a>
        ) : (
          <div className={styles.avatar}>
            <User size={12} color="var(--color-text-muted)" />
          </div>
        )}
      </div>
    </div>
  );
}
