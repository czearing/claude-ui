'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { clsx } from 'clsx';

import { TaskCard } from '@/components/TaskCard';
import type { Task } from '@/utils/tasks.types';
import styles from './Column.module.css';
import type { ColumnProps } from './Column.types';
import { ColumnEmptyState } from './ColumnEmptyState';
import { ColumnHeader } from './ColumnHeader';

type SortableTaskCardProps = {
  task: Task;
  onOpenDetail: (id: string) => void;
};

function SortableTaskCard({ task, onOpenDetail }: SortableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(isDragging && styles.ghost)}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} onOpenDetail={onOpenDetail} />
    </div>
  );
}

export function Column({
  columnId,
  label,
  tasks,
  accentColor,
  isAutomated,
  onOpenDetail,
  className,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const hasActiveAgent = tasks.some((t) => t.agentPid != null);
  const taskIds = tasks.map((t) => t.id);

  return (
    <section
      className={clsx(styles.column, isOver && styles.columnOver, className)}
      aria-label={`${label} column`}
    >
      <ColumnHeader
        label={label}
        count={tasks.length}
        accentColor={accentColor}
        isAutomated={isAutomated}
        hasActiveAgent={hasActiveAgent}
      />
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={styles.taskList} role="list">
          {tasks.length === 0 ? (
            <ColumnEmptyState status={columnId} />
          ) : (
            tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                onOpenDetail={onOpenDetail}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}
