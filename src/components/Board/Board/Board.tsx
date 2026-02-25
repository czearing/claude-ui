"use client";

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
import { useState } from "react";

import { useUpdateTask } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import type { Task, TaskStatus } from "@/utils/tasks.types";
import { Column } from "../Column";
import { TaskCard } from "../TaskCard";
import styles from "./Board.module.css";

const BOARD_COLUMNS: TaskStatus[] = [
  "Not Started",
  "In Progress",
  "Review",
  "Done",
];

interface BoardProps {
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}

export function Board({ tasks, onSelectTask }: BoardProps) {
  useTasksSocket();

  const { mutate: updateTask } = useUpdateTask();
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
    if (!over) return;

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
              tasks={tasks.filter((t) => t.status === status)}
              onSelectTask={onSelectTask}
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
