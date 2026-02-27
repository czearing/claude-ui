"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { Backlog } from "@/components/Board/Backlog";
import { Board } from "@/components/Board/Board";
import { type View } from "@/components/Layout/Sidebar";
import { TopBar } from "@/components/Layout/TopBar";
import { TerminalFlyout } from "@/components/Terminal/TerminalFlyout";
import { useCreateTask, useHandoverTask, useTasks } from "@/hooks/useTasks";
import type { Task } from "@/utils/tasks.types";
import styles from "./AppShell.module.css";
import { useSplitPane } from "./useSplitPane";

const SpecEditor = dynamic(
  () => import("@/components/Editor/SpecEditor").then((m) => m.SpecEditor),
  { ssr: false },
);

interface AppShellProps {
  repo: string;
  view: View;
  selectedTaskId?: string;
}

export function AppShell({
  repo,
  view: currentView,
  selectedTaskId: initialTaskId,
}: AppShellProps) {
  const { data: tasks = [] } = useTasks(repo);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    initialTaskId ?? null,
  );
  // stagedSelectedTask is the fallback for tasks not yet in the cache (e.g.
  // right after creation before the React Query list has refreshed).
  const [stagedSelectedTask, setStagedSelectedTask] = useState<Task | null>(
    null,
  );
  const [openSessionIds, setOpenSessionIds] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const selectedTask =
    tasks.find((t) => t.id === selectedTaskId) ?? stagedSelectedTask;
  const handoverTask = useHandoverTask(repo);
  const { mutate: createTask } = useCreateTask(repo);
  const { contentRef, leftRef, leftWidth, openPane, handleDividerMouseDown } =
    useSplitPane();
  const paneInitRef = useRef(false);

  const boardTasks = tasks.filter((t) => t.status !== "Backlog");

  // Derive visible sessions at render time rather than in an effect.
  // Sessions whose tasks have ended (sessionId cleared) are filtered out here,
  // avoiding a setState-in-effect that would trigger cascading renders.
  const liveSessionIds = new Set(
    tasks.flatMap((t) => (t.sessionId ? [t.sessionId] : [])),
  );
  const visibleSessionIds = openSessionIds.filter((id) =>
    liveSessionIds.has(id),
  );
  const visibleActiveSessionId =
    activeSessionId && liveSessionIds.has(activeSessionId)
      ? activeSessionId
      : (visibleSessionIds.at(-1) ?? null);

  // Derive tab metadata for whichever sessions the user has opened
  const flyoutSessions = visibleSessionIds.map((sessionId) => {
    const task = tasks.find((t) => t.sessionId === sessionId);
    return {
      sessionId,
      taskId: task?.id ?? sessionId,
      title: task?.title ?? "Session",
      status: task?.status,
    };
  });

  useEffect(() => {
    if (paneInitRef.current || !initialTaskId || !selectedTask) {
      return;
    }
    paneInitRef.current = true;
    openPane();
  }, [initialTaskId, selectedTask, openPane]);

  useEffect(() => {
    if (!selectedTask) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedTaskId(null);
        setStagedSelectedTask(null);
        if (currentView === "Tasks") {
          window.history.replaceState(
            null,
            "",
            `/repos/${encodeURIComponent(repo)}/tasks`,
          );
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedTask, currentView, repo]);

  function handleNewTask() {
    createTask(
      { title: "", status: "Backlog" },
      { onSuccess: (task) => handleSelectTask(task) },
    );
  }

  function openSession(sessionId: string) {
    setOpenSessionIds((prev) =>
      prev.includes(sessionId) ? prev : [...prev, sessionId],
    );
    setActiveSessionId(sessionId);
  }

  function handleCloseTab(sessionId: string) {
    const remaining = openSessionIds.filter((id) => id !== sessionId);
    if (activeSessionId === sessionId) {
      const idx = openSessionIds.indexOf(sessionId);
      setActiveSessionId(
        remaining.length > 0 ? remaining[Math.max(0, idx - 1)] : null,
      );
    }
    setOpenSessionIds(remaining);
  }

  function handleHandover(taskId: string) {
    handoverTask.mutate(taskId, {
      onSuccess: (task) => {
        if (task.sessionId) {
          openSession(task.sessionId);
        }
      },
    });
  }

  function handleSelectTask(task: Task) {
    if (currentView === "Board") {
      if (task.sessionId) {
        openSession(task.sessionId);
      }
      return;
    }
    openPane();
    setSelectedTaskId(task.id);
    setStagedSelectedTask(task);
    window.history.replaceState(
      null,
      "",
      `/repos/${encodeURIComponent(repo)}/tasks/${task.id}`,
    );
  }

  function deselect() {
    setSelectedTaskId(null);
    setStagedSelectedTask(null);
    if (currentView === "Tasks") {
      window.history.replaceState(
        null,
        "",
        `/repos/${encodeURIComponent(repo)}/tasks`,
      );
    }
  }

  return (
    <main className={styles.main}>
      <TopBar repo={repo} currentView={currentView} />

      <div ref={contentRef} className={styles.content}>
        <div
          ref={leftRef}
          className={styles.left}
          style={{ width: selectedTask ? `${leftWidth}px` : "100%" }}
        >
          {currentView === "Board" ? (
            <Board
              repo={repo}
              tasks={boardTasks}
              onSelectTask={handleSelectTask}
              onHandover={handleHandover}
            />
          ) : (
            <Backlog
              repo={repo}
              onSelectTask={handleSelectTask}
              onNewTask={handleNewTask}
              selectedTaskId={selectedTaskId ?? undefined}
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
                repo={repo}
                task={selectedTask}
                onClose={deselect}
                inline
              />
            </div>
          </>
        )}
      </div>

      {visibleSessionIds.length > 0 && visibleActiveSessionId && (
        <TerminalFlyout
          sessions={flyoutSessions}
          activeSessionId={visibleActiveSessionId}
          onSelectSession={setActiveSessionId}
          onCloseTab={handleCloseTab}
          onClose={() => {
            setOpenSessionIds([]);
            setActiveSessionId(null);
          }}
        />
      )}
    </main>
  );
}
