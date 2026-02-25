import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import clsx from "clsx";

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

export function Column({
  status,
  tasks,
  onSelectTask,
  onRemoveTask,
  onRecall,
  onHandover: _onHandover,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

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
        className={clsx(styles.dropZone, isOver && styles.dropZoneOver)}
      >
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
