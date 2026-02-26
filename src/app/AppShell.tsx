"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { Backlog } from "@/components/Board/Backlog";
import { Board } from "@/components/Board/Board";
import { Sidebar, type View } from "@/components/Layout/Sidebar";
import { TopBar } from "@/components/Layout/TopBar";
import { useCreateTask, useHandoverTask, useTasks } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import type { Task } from "@/utils/tasks.types";
import styles from "./AppShell.module.css";
import { useSplitPane } from "./useSplitPane";

const SpecEditor = dynamic(
  () => import("@/components/Editor/SpecEditor").then((m) => m.SpecEditor),
  { ssr: false },
);

interface AppShellProps {
  repoId: string;
  view: View;
}

export function AppShell({ repoId, view: currentView }: AppShellProps) {
  const { data: tasks = [] } = useTasks(repoId);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const router = useRouter();
  const handoverTask = useHandoverTask(repoId);
  const { mutate: createTask } = useCreateTask(repoId);
  const { contentRef, leftRef, leftWidth, openPane, handleDividerMouseDown } =
    useSplitPane();

  useTasksSocket();

  const agentActive = tasks.some((t) => t.status === "In Progress");
  const boardTasks = useMemo(
    () => tasks.filter((t) => t.status !== "Backlog"),
    [tasks],
  );

  useEffect(() => {
    if (!selectedTask) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedTask(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedTask]);

  function handleNewTask() {
    createTask(
      { title: "", priority: "Medium", status: "Backlog" },
      { onSuccess: (task) => handleSelectTask(task) },
    );
  }

  function handleHandover(taskId: string) {
    handoverTask.mutate(taskId, {
      onSuccess: (task) => {
        if (task.sessionId) {
          router.push(`/repos/${repoId}/session/${task.sessionId}`);
        }
      },
    });
  }

  function handleSelectTask(task: Task) {
    if (currentView === "Board") {
      if (task.sessionId) {
        router.push(`/repos/${repoId}/session/${task.sessionId}`);
      }
      return;
    }
    openPane();
    setSelectedTask(task);
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        repoId={repoId}
        currentView={currentView}
        agentActive={agentActive}
      />

      <main className={styles.main}>
        <TopBar repoId={repoId} currentView={currentView} />

        <div ref={contentRef} className={styles.content}>
          <div
            ref={leftRef}
            className={styles.left}
            style={{ width: selectedTask ? `${leftWidth}px` : "100%" }}
          >
            {currentView === "Board" ? (
              <Board
                repoId={repoId}
                tasks={boardTasks}
                onSelectTask={handleSelectTask}
                onHandover={handleHandover}
              />
            ) : (
              <Backlog
                repoId={repoId}
                onSelectTask={handleSelectTask}
                onNewTask={handleNewTask}
                selectedTaskId={selectedTask?.id}
              />
            )}
          </div>

          {selectedTask && (
            <>
              <div
                className={styles.divider}
                onMouseDown={handleDividerMouseDown}
              />
              <div className={styles.right}>
                <SpecEditor
                  key={selectedTask.id}
                  repoId={repoId}
                  task={selectedTask}
                  onClose={() => setSelectedTask(null)}
                  inline
                />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
