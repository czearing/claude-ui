"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import clsx from "clsx";
import { Archive } from "@phosphor-icons/react";

import type { TaskStatus } from "@/utils/tasks.types";
import styles from "./Column.module.css";
import type { ColumnProps } from "./Column.types";
import { TaskCard } from "../TaskCard";

const DOT_CLASS: Record<TaskStatus, string> = {
  Backlog: styles.dotGray,
  "Not Started": styles.dotLight,
  "In Progress": styles.dotAgent,
  Review: styles.dotOrange,
  Done: styles.dotGreen,
};

const DROP_OVER_CLASS: Record<TaskStatus, string | undefined> = {
  Backlog: undefined,
  "Not Started": undefined,
  "In Progress": styles.dropZoneOverInProgress,
  Review: styles.dropZoneOverReview,
  Done: styles.dropZoneOverDone,
};

export function Column({
  status,
  tasks,
  onSelectTask,
  onRemoveTask,
  onRecall,
  onHandover: _onHandover,
  isDropDisabled = false,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    disabled: isDropDisabled,
  });

  return (
    <div className={styles.column}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={clsx(styles.statusDot, DOT_CLASS[status])} />
          <h3 className={styles.statusTitle}>{status}</h3>
          <span className={styles.badge}>{tasks.length}</span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={clsx(styles.dropZone, isOver && DROP_OVER_CLASS[status])}
      >
        {isOver && status === "Done" && (
          <div className={styles.archiveOverlay}>
            <Archive
              className={styles.archiveOverlayIcon}
              size={28}
              weight="duotone"
            />
            <span className={styles.archiveOverlayText}>Move to Archives</span>
          </div>
        )}
        <SortableContext
          items={tasks.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onSelect={onSelectTask}
              onRemove={onRemoveTask}
              onRecall={onRecall}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
