import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRight, FileText, Kanban, X } from "@phosphor-icons/react";
import clsx from "clsx";

import styles from "./TaskCard.module.css";
import type { TaskCardProps } from "./TaskCard.types";

export function TaskCard({
  task,
  onSelect,
  onRemove,
  selected,
}: TaskCardProps) {
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

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${task.title}"?`)) {
      onRemove!(task.id);
    }
  };

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
        selected && styles.cardSelected,
      )}
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <FileText size={14} className={styles.docIcon} />
          <span className={clsx(styles.title, isDone && styles.titleDone)}>
            {task.title}
          </span>
        </div>
        <div className={styles.headerRight}>
          {isReview && <span className={styles.reviewBadge}>Review</span>}
          {onRemove && (
            <button
              className={styles.removeBtn}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={handleRemove}
              aria-label="Remove task"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {isAgentActive && (
        <div className={styles.agentBadge}>
          <div className={styles.shimmer} />
          <Kanban size={12} />
          <span>Agent Processing...</span>
        </div>
      )}

      <div className={styles.footer}>
        <div className={styles.meta} />

        {task.sessionId && (
          <a
            href={`/repos/${task.repoId}/session/${task.sessionId}`}
            className={styles.sessionLink}
            onClick={(e) => e.stopPropagation()}
          >
            <span>Terminal</span>
            <ArrowRight size={10} />
          </a>
        )}
      </div>
    </div>
  );
}
