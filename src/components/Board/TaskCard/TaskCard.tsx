"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowCounterClockwise,
  ArrowRight,
  DotsThree,
  FileText,
  Kanban,
  Trash,
} from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";

import styles from "./TaskCard.module.css";
import type { TaskCardProps } from "./TaskCard.types";

export function TaskCard({
  task,
  onSelect,
  onRemove,
  onRecall,
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

  const [menuOpen, setMenuOpen] = useState(false);

  const style = { transform: CSS.Transform.toString(transform), transition };
  const isAgentActive = task.status === "In Progress";
  const isReview = task.status === "Review";
  const isDone = task.status === "Done";

  const handleRecall = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRecall?.(task.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(task.id);
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
          {(onRemove ?? onRecall) && (
            <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenu.Trigger asChild>
                <button
                  className={`${styles.menuTrigger} ${menuOpen ? styles.menuTriggerOpen : ""}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Task actions"
                >
                  <DotsThree size={14} weight="bold" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content
                className={styles.menuContent}
                align="end"
                sideOffset={4}
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                {isAgentActive && onRecall && (
                  <>
                    <DropdownMenu.Item asChild>
                      <button
                        className={styles.menuItem}
                        onClick={handleRecall}
                      >
                        <span className={styles.menuItemLabel}>
                          <ArrowCounterClockwise size={13} />
                          Move to Backlog
                        </span>
                        <span className={styles.menuItemSubtext}>
                          stops the running agent
                        </span>
                      </button>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className={styles.menuSeparator} />
                  </>
                )}
                {onRemove && (
                  <DropdownMenu.Item asChild>
                    <button
                      className={`${styles.menuItem} ${styles.menuItemDanger}`}
                      onClick={handleDelete}
                    >
                      <span className={styles.menuItemLabel}>
                        <Trash size={13} />
                        Delete
                      </span>
                    </button>
                  </DropdownMenu.Item>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
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
