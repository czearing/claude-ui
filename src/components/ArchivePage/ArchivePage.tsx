"use client";

import { useState } from "react";
import { Archive, DotsThree, Trash } from "@phosphor-icons/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { Sidebar } from "@/components/Layout/Sidebar";
import { TopBar } from "@/components/Layout/TopBar";
import { useDeleteTask, useTasks, useUpdateTask } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import { formatRelativeDate } from "@/utils/formatRelativeDate";
import type { Priority } from "@/utils/tasks.types";
import styles from "./ArchivePage.module.css";
import type { ArchivePageProps } from "./ArchivePage.types";

const PRIORITY_CLASS: Record<Priority, string> = {
  Low: styles.priorityLow,
  Medium: styles.priorityMedium,
  High: styles.priorityHigh,
  Urgent: styles.priorityUrgent,
};

export function ArchivePage({ repoId }: ArchivePageProps) {
  useTasksSocket();

  const { data: allTasks = [] } = useTasks(repoId);
  const { mutate: updateTask } = useUpdateTask(repoId);
  const { mutate: deleteTask } = useDeleteTask(repoId);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const agentActive = allTasks.some((t) => t.status === "In Progress");
  const archivedTasks = allTasks
    .filter((t) => t.status === "Done")
    .sort((a, b) => {
      const aTime = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
      const bTime = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
      return bTime - aTime; // newest archived first
    });

  function handleRestore(taskId: string) {
    updateTask({ id: taskId, status: "Backlog" });
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        repoId={repoId}
        currentView="Archive"
        agentActive={agentActive}
      />

      <main className={styles.main}>
        <TopBar repoId={repoId} currentView="Archive" />

        <div className={styles.content}>
          <div className={styles.inner}>
            <div className={styles.headerRow}>
              <div>
                <h1 className={styles.heading}>Archive</h1>
                <p className={styles.subheading}>
                  Completed tasks ({archivedTasks.length})
                </p>
              </div>
            </div>

            <div className={styles.list}>
              {archivedTasks.map((task) => (
                <div key={task.id} className={styles.row}>
                  <div className={styles.rowLeft}>
                    <div className={styles.rowContent}>
                      <span
                        className={`${styles.rowTitle}${!task.title ? ` ${styles.rowTitleEmpty}` : ""}`}
                      >
                        {task.title || "Untitled"}
                      </span>
                      <div className={styles.rowMeta}>
                        <span
                          className={`${styles.priority} ${PRIORITY_CLASS[task.priority]}`}
                        >
                          {task.priority}
                        </span>
                        <span className={styles.rowDate}>
                          Archived{" "}
                          {task.archivedAt
                            ? formatRelativeDate(task.archivedAt)
                            : formatRelativeDate(task.updatedAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.rowActions}>
                    <button
                      className={styles.restoreButton}
                      onClick={() => handleRestore(task.id)}
                    >
                      Restore
                    </button>

                    <DropdownMenu.Root
                      open={openMenuId === task.id}
                      onOpenChange={(open) =>
                        setOpenMenuId(open ? task.id : null)
                      }
                    >
                      <DropdownMenu.Trigger asChild>
                        <button
                          className={`${styles.moreButton} ${openMenuId === task.id ? styles.moreButtonOpen : ""}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`More actions for ${task.title}`}
                        >
                          <DotsThree size={16} weight="bold" />
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content
                        className={styles.menuContent}
                        align="end"
                        sideOffset={4}
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <DropdownMenu.Item
                          className={`${styles.menuItem} ${styles.menuItemDanger}`}
                          onSelect={() => deleteTask(task.id)}
                        >
                          <span className={styles.menuItemLabel}>
                            <Trash size={13} />
                            Delete
                          </span>
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  </div>
                </div>
              ))}

              {archivedTasks.length === 0 && (
                <div className={styles.emptyState}>
                  <Archive size={32} className={styles.emptyIcon} />
                  <p>
                    No archived tasks yet. Drag tasks to Done on the board to
                    archive them.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
