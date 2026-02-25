"use client";

import { useState } from "react";
import {
  DotsThree,
  FileText,
  MagnifyingGlass,
  Plus,
  Sparkle,
} from "@phosphor-icons/react";

import { useDeleteTask, useHandoverTask, useTasks } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import { formatRelativeDate } from "@/utils/formatRelativeDate";
import type { Task } from "@/utils/tasks.types";
import styles from "./Backlog.module.css";

type SortBy = "newest" | "oldest" | "az" | "za";

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
            <h1 className={styles.heading}>Backlog</h1>
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
          <select
            aria-label="Sort"
            className={styles.sortSelect}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="az">A → Z</option>
            <option value="za">Z → A</option>
          </select>
        </div>

        <div className={styles.list}>
          {sorted.map((task) => (
            <div
              key={task.id}
              className={`${styles.row} ${task.id === selectedTaskId ? styles.rowSelected : ""}`}
              onClick={() => onSelectTask(task)}
            >
              <div className={styles.rowLeft}>
                <div className={styles.docIcon}>
                  <FileText size={16} />
                </div>
                <div className={styles.rowContent}>
                  <span className={styles.rowTitle}>{task.title}</span>
                  <span className={styles.rowDate}>
                    {formatRelativeDate(task.createdAt)}
                  </span>
                </div>
              </div>

              <div className={styles.rowActions}>
                <button
                  className={styles.agentButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    handoverTask(task.id);
                  }}
                  aria-label={`Send ${task.title} to agent`}
                >
                  <Sparkle size={14} aria-hidden="true" />
                  Send to Agent
                </button>
                <button
                  className={styles.moreButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTask(task.id);
                  }}
                  aria-label={`Delete ${task.title}`}
                >
                  <DotsThree size={16} weight="bold" />
                </button>
              </div>
            </div>
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
