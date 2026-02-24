'use client';

import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { clsx } from 'clsx';
import { motion } from 'framer-motion';

import { TaskCard } from '@/components/TaskCard';
import type { Task, TaskStatus } from '@/utils/tasks.types';
import styles from './Board.module.css';
import type { BoardProps } from './Board.types';
import { Column } from '../Column';

type ColumnDef = {
  id: TaskStatus;
  label: string;
  accentColor: string;
  isAutomated?: boolean;
};

const COLUMNS: ColumnDef[] = [
  { id: 'backlog', label: 'Backlog', accentColor: 'var(--column-Backlog)' },
  {
    id: 'not_started',
    label: 'Not Started',
    accentColor: 'var(--column-NotStarted)',
    isAutomated: true,
  },
  {
    id: 'in_progress',
    label: 'In Progress',
    accentColor: 'var(--column-InProgress)',
    isAutomated: false,
  },
  {
    id: 'review',
    label: 'Review',
    accentColor: 'var(--column-Review)',
    isAutomated: true,
  },
  { id: 'done', label: 'Done', accentColor: 'var(--column-Done)' },
];

export function Board({ tasks, onOpenDetail, onMoveTask, className }: BoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) {return;}

    const draggedTaskId = active.id as string;
    const overId = over.id as string;

    const draggedTask = tasks.find((t) => t.id === draggedTaskId);
    if (!draggedTask) {return;}

    // Determine target status: over.id may be a column id or a task id
    const isColumnTarget = COLUMNS.some((c) => c.id === overId);
    const targetStatus: TaskStatus = isColumnTarget
      ? (overId as TaskStatus)
      : (tasks.find((t) => t.id === overId)?.status ?? draggedTask.status);

    if (targetStatus === draggedTask.status && overId === draggedTaskId) {return;}

    // Compute new columnOrder: append at end of target column
    const targetColumnTasks = tasks
      .filter((t) => t.status === targetStatus && t.id !== draggedTaskId)
      .sort((a, b) => a.columnOrder - b.columnOrder);

    let newOrder: number;
    if (isColumnTarget) {
      newOrder =
        targetColumnTasks.length > 0
          ? targetColumnTasks[targetColumnTasks.length - 1].columnOrder + 1
          : 0;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      newOrder = overTask ? overTask.columnOrder : targetColumnTasks.length;
    }

    onMoveTask(draggedTaskId, targetStatus, newOrder);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className={clsx(styles.board, className)}
        role="region"
        aria-label="Task board"
      >
        {COLUMNS.map((col) => (
          <Column
            key={col.id}
            columnId={col.id}
            label={col.label}
            tasks={tasks.filter((t) => t.status === col.id)}
            accentColor={col.accentColor}
            isAutomated={col.isAutomated}
            onOpenDetail={onOpenDetail}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <motion.div
            initial={{ rotate: 0 }}
            animate={{ rotate: 1.5 }}
            transition={{ duration: 0.15 }}
          >
            <TaskCard
              task={activeTask}
              onOpenDetail={onOpenDetail}
              className={styles.overlayCard}
            />
          </motion.div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
