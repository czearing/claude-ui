"use client";

import { useState } from "react";
import { FileText, MagnifyingGlass, Plus } from "@phosphor-icons/react";

import {
  Select,
  SelectCaret,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/Select";
import { useDeleteTask, useHandoverTask, useTasks } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import type { Task } from "@/utils/tasks.types";
import styles from "./Backlog.module.css";
import { BacklogRow } from "./BacklogRow";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "az", label: "A → Z" },
  { value: "za", label: "Z → A" },
] as const;

type SortBy = (typeof SORT_OPTIONS)[number]["value"];

function sortTasks(tasks: Task[], sortBy: SortBy): Task[] {
  return [...tasks].sort((a, b) => {
    switch (sortBy) {
      case "newest":
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      case "oldest":
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      case "az":
        return a.title.localeCompare(b.title);
      case "za":
        return b.title.localeCompare(a.title);
    }
  });
}

interface BacklogProps {
  repoId: string;
  onSelectTask: (task: Task) => void;
  onNewTask: () => void;
  selectedTaskId?: string;
}

export function Backlog({
  repoId,
  onSelectTask,
  onNewTask,
  selectedTaskId,
}: BacklogProps) {
  useTasksSocket();

  const { data: allTasks = [] } = useTasks(repoId);
  const { mutate: deleteTask } = useDeleteTask(repoId);
  const { mutate: handoverTask } = useHandoverTask(repoId);

  const backlogTasks = allTasks.filter((t) => t.status === "Backlog");

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filtered = search.trim()
    ? backlogTasks.filter((t) =>
        t.title.toLowerCase().includes(search.toLowerCase()),
      )
    : backlogTasks;

  const sorted = sortTasks(filtered, sortBy);

  return (
    <div className={styles.backlog}>
      <div className={styles.inner}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.heading}>Tasks</h1>
            <p className={styles.subheading}>Manage your issues and tasks</p>
          </div>
          <button className={styles.newButton} onClick={onNewTask}>
            <Plus size={16} />
            New Task
          </button>
        </div>

        <div className={styles.searchRow}>
          <div className={styles.searchWrap}>
            <MagnifyingGlass
              size={16}
              className={styles.searchIcon}
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issues..."
              className={styles.searchInput}
            />
          </div>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger aria-label="Sort">
              <SelectValue />
              <SelectCaret />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className={styles.list}>
          {sorted.map((task) => (
            <BacklogRow
              key={task.id}
              task={task}
              isSelected={task.id === selectedTaskId}
              isMenuOpen={openMenuId === task.id}
              onSelect={() => onSelectTask(task)}
              onSetMenuOpen={(open) => setOpenMenuId(open ? task.id : null)}
              onHandover={() => handoverTask(task.id)}
              onDelete={() => deleteTask(task.id)}
            />
          ))}

          {sorted.length === 0 && (
            <div className={styles.emptyState}>
              <FileText size={32} className={styles.emptyIcon} />
              <p>
                {search.trim()
                  ? "No issues match your search."
                  : "No issues in the backlog. Create a new task to get started."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
