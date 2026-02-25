"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Backlog } from "@/components/Board/Backlog";
import { Board } from "@/components/Board/Board";
import { SpecEditor } from "@/components/Editor/SpecEditor";
import { Sidebar, type View } from "@/components/Layout/Sidebar";
import { TopBar } from "@/components/Layout/TopBar";
import { useTasks } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import { useHandoverTask } from "@/hooks/useTasks";
import type { Task } from "@/utils/tasks.types";
import styles from "./AppShell.module.css";

interface AppShellProps {
  repoId: string;
}

export function AppShell({ repoId }: AppShellProps) {
  const { data: tasks = [] } = useTasks(repoId);
  const [currentView, setCurrentView] = useState<View>("Board");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [focusBacklogCreate, setFocusBacklogCreate] = useState(false);
  const router = useRouter();
  const handoverTask = useHandoverTask(repoId);

  useTasksSocket();

  const agentActive = tasks.some((t) => t.status === "In Progress");

  function handleNewTask() {
    setCurrentView("Backlog");
    setFocusBacklogCreate(true);
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

  return (
    <div className={styles.shell}>
      <Sidebar
        repoId={repoId}
        currentView={currentView}
        agentActive={agentActive}
        onViewChange={setCurrentView}
      />

      <main className={styles.main}>
        <TopBar currentView={currentView} onNewTask={handleNewTask} />

        <div className={styles.content}>
          {currentView === "Board" ? (
            <Board
              repoId={repoId}
              tasks={tasks.filter((t) => t.status !== "Backlog")}
              onSelectTask={setSelectedTask}
              onHandover={handleHandover}
            />
          ) : (
            <Backlog
              repoId={repoId}
              onSelectTask={setSelectedTask}
              focusCreate={focusBacklogCreate}
              onFocused={() => setFocusBacklogCreate(false)}
            />
          )}

          {selectedTask && (
            <div
              className={styles.backdrop}
              onClick={() => setSelectedTask(null)}
            />
          )}

          <SpecEditor
            repoId={repoId}
            task={selectedTask}
            onClose={() => setSelectedTask(null)}
          />
        </div>
      </main>
    </div>
  );
}
