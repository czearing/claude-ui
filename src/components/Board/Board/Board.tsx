"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { useDeleteTask, useRecallTask, useUpdateTask } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import type { Task, TaskStatus } from "@/utils/tasks.types";
import styles from "./Board.module.css";
import { Column } from "../Column";
import { TaskCard } from "../TaskCard";

const BOARD_COLUMNS: TaskStatus[] = ["In Progress", "Review", "Done"];

interface BoardProps {
  repoId: string;
  tasks: Task[];
  onSelectTask: (task: Task) => void;
  onHandover?: (taskId: string) => void;
}

export function Board({ repoId, tasks, onSelectTask, onHandover }: BoardProps) {
  useTasksSocket();

  const { mutate: updateTask } = useUpdateTask(repoId);
  const { mutate: deleteTask } = useDeleteTask(repoId);
  const { mutate: recallTask } = useRecallTask(repoId);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveTask(tasks.find((t) => t.id === active.id) ?? null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveTask(null);
    if (!over) {
      return;
    }

    const overId = over.id as string;
    const targetStatus = BOARD_COLUMNS.includes(overId as TaskStatus)
      ? (overId as TaskStatus)
      : (tasks.find((t) => t.id === overId)?.status ?? null);

    if (targetStatus && active.id !== over.id) {
      updateTask({ id: active.id as string, status: targetStatus });
    }
  };

  return (
    <div className={styles.board}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className={styles.columns}>
          {BOARD_COLUMNS.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={status === "Done" ? [] : tasks.filter((t) => t.status === status)}
              onSelectTask={onSelectTask}
              onRemoveTask={deleteTask}
              onRecall={recallTask}
              onHandover={onHandover}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <TaskCard task={activeTask} onSelect={() => undefined} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
