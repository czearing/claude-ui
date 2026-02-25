"use client";

import { Plus } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { useCreateTask, useDeleteTask, useTasks } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import type { Task } from "@/utils/tasks.types";
import { TaskCard } from "../TaskCard";
import styles from "./Backlog.module.css";

interface BacklogProps {
  repoId: string;
  onSelectTask: (task: Task) => void;
  focusCreate?: boolean;
  onFocused?: () => void;
}

export function Backlog({
  repoId,
  onSelectTask,
  focusCreate,
  onFocused,
}: BacklogProps) {
  useTasksSocket();

  const { data: allTasks = [] } = useTasks(repoId);
  const { mutate: createTask } = useCreateTask(repoId);
  const { mutate: deleteTask } = useDeleteTask(repoId);
  const backlogTasks = allTasks.filter((t) => t.status === "Backlog");

  const [draftTitle, setDraftTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusCreate) {
      inputRef.current?.focus();
      onFocused?.();
    }
  }, [focusCreate, onFocused]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftTitle.trim()) return;
    createTask({
      title: draftTitle.trim(),
      priority: "Medium",
      status: "Backlog",
    });
    setDraftTitle("");
  };

  return (
    <div className={styles.backlog}>
      <div className={styles.inner}>
        <div className={styles.headerRow}>
          <h1 className={styles.heading}>Backlog</h1>
          <span className={styles.count}>{backlogTasks.length} issues</span>
        </div>

        <form onSubmit={handleSubmit} className={styles.createForm}>
          <Plus size={20} color="var(--color-text-muted)" />
          <input
            ref={inputRef}
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Create a new draft..."
            className={styles.createInput}
          />
          <button
            type="submit"
            disabled={!draftTitle.trim()}
            className={styles.addButton}
          >
            Add
          </button>
        </form>

        <div className={styles.list}>
          {backlogTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onSelect={onSelectTask}
              onRemove={deleteTask}
            />
          ))}
          {backlogTasks.length === 0 && (
            <div className={styles.emptyState}>
              No issues in the backlog. Create a draft above to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
