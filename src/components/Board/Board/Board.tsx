"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { useDeleteTask, useRecallTask, useUpdateTask } from "@/hooks/useTasks";
import type { Task, TaskStatus } from "@/utils/tasks.types";
import styles from "./Board.module.css";
import { Column } from "../Column";
import { TaskCard } from "../TaskCard";

const BOARD_COLUMNS: TaskStatus[] = ["In Progress", "Review", "Done"];
const EMPTY: Task[] = [];

interface BoardProps {
  repo: string;
  tasks: Task[];
  onSelectTask: (task: Task) => void;
  onHandover?: (taskId: string) => void;
}

export function Board({ repo, tasks, onSelectTask, onHandover }: BoardProps) {
  const { mutate: updateTask } = useUpdateTask(repo);
  const { mutate: deleteTask } = useDeleteTask(repo);
  const { mutate: recallTask } = useRecallTask(repo);
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

    if (!targetStatus || active.id === over.id) {
      return;
    }

    const sourceStatus = tasks.find((t) => t.id === active.id)?.status;
    // Only Review can move to Done; Review cannot move back to In Progress;
    // In Progress cannot be manually moved to Review (the agent sets Review status)
    if (targetStatus === "Done" && sourceStatus !== "Review") {
      return;
    }
    if (sourceStatus === "Review" && targetStatus === "In Progress") {
      return;
    }
    if (sourceStatus === "In Progress" && targetStatus === "Review") {
      return;
    }

    updateTask({ id: active.id as string, status: targetStatus });
  };

  return (
    <div className={styles.board}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className={styles.columns}>
          {BOARD_COLUMNS.map((status) => {
            const isDropDisabled =
              (status === "Done" && activeTask?.status !== "Review") ||
              (status === "In Progress" && activeTask?.status === "Review") ||
              (status === "Review" && activeTask?.status === "In Progress");
            return (
              <Column
                key={status}
                status={status}
                tasks={
                  status === "Done"
                    ? EMPTY
                    : tasks.filter((t) => t.status === status)
                }
                onSelectTask={onSelectTask}
                onRemoveTask={deleteTask}
                onRecall={recallTask}
                onHandover={onHandover}
                isDropDisabled={Boolean(activeTask) && isDropDisabled}
              />
            );
          })}
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
