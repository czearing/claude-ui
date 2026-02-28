"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { Backlog } from "@/components/Board/Backlog";
import { Board } from "@/components/Board/Board";
import { type View } from "@/components/Layout/Sidebar";
import { TopBar } from "@/components/Layout/TopBar";
import { useCreateTask, useTasks } from "@/hooks/useTasks";
import type { Task } from "@/utils/tasks.types";
import styles from "./AppShell.module.css";
import { useBackgroundHandover } from "./useBackgroundHandover";
import { useSplitPane } from "./useSplitPane";

const SpecEditor = dynamic(
  () => import("@/components/Editor/SpecEditor").then((m) => m.SpecEditor),
  { ssr: false },
);

const ChatPanel = dynamic(
  () => import("@/components/Chat/ChatPanel").then((m) => m.ChatPanel),
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
  const [chatTaskId, setChatTaskId] = useState<string | null>(null);

  const selectedTask =
    tasks.find((t) => t.id === selectedTaskId) ?? stagedSelectedTask;
  const { mutate: createTask } = useCreateTask(repo);
  const { contentRef, leftRef, leftWidth, openPane, handleDividerMouseDown } =
    useSplitPane();
  const paneInitRef = useRef<string | null>(null);
  const startBackgroundHandover = useBackgroundHandover();

  const boardTasks = tasks.filter((t) => t.status !== "Backlog");

  // chatTask tracks the active chat regardless of view so ChatPanel stays mounted
  // across Board/Tasks navigation and the stream is never interrupted.
  const chatTask = chatTaskId
    ? (tasks.find((t) => t.id === chatTaskId) ?? null)
    : null;
  // chatPanelVisible controls CSS visibility — ChatPanel is hidden but alive in Tasks view.
  const chatPanelVisible = currentView === "Board" && chatTask !== null;
  // rightTask drives the split-pane width and divider: show chat when visible, otherwise spec.
  const rightTask = chatPanelVisible ? chatTask : (selectedTask ?? null);

  useEffect(() => {
    if (
      !initialTaskId ||
      !selectedTask ||
      paneInitRef.current === initialTaskId
    ) {
      return;
    }
    paneInitRef.current = initialTaskId;
    openPane();
  }, [initialTaskId, selectedTask, openPane]);

  useEffect(() => {
    if (!rightTask) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        deselect();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightTask, currentView, repo]);

  function handleNewTask() {
    createTask(
      { title: "", status: "Backlog" },
      { onSuccess: (task) => handleSelectTask(task) },
    );
  }

  function handleHandover(taskId: string) {
    setSelectedTaskId(null);
    setStagedSelectedTask(null);
    if (currentView === "Board") {
      // Board view: open ChatPanel on the right
      setChatTaskId(taskId);
      openPane();
    } else {
      // Tasks view: kick off Claude in background, no panel
      startBackgroundHandover(taskId);
    }
  }

  function handleSelectTask(task: Task) {
    if (currentView === "Board") {
      setChatTaskId(task.id);
      openPane();
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

  function closeSpec() {
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

  function deselect() {
    closeSpec();
    // Only close the chat when it's currently visible; don't kill a background
    // session just because the user pressed Escape on a SpecEditor in Tasks view.
    if (chatPanelVisible) {
      setChatTaskId(null);
    }
  }

  return (
    <main className={styles.main}>
      <TopBar repo={repo} currentView={currentView} />

      <div ref={contentRef} className={styles.content}>
        <div
          ref={leftRef}
          className={styles.left}
          style={{ width: rightTask ? `${leftWidth}px` : "100%" }}
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
              onHandover={handleHandover}
              selectedTaskId={selectedTaskId ?? undefined}
            />
          )}
        </div>

        {rightTask && (
          <div
            className={styles.divider}
            onMouseDown={handleDividerMouseDown}
          />
        )}

        {/* Always keep ChatPanel mounted while a chat session is open so the
            stream survives Board/Tasks navigation. CSS hides it in Tasks view. */}
        {chatTask && (
          <div
            className={styles.right}
            style={{ display: chatPanelVisible ? undefined : "none" }}
          >
            <ChatPanel key={chatTask.id} task={chatTask} onClose={deselect} />
          </div>
        )}

        {/* SpecEditor: shown when no chat panel is visible and a task is selected */}
        {!chatPanelVisible && selectedTask && (
          <div className={styles.right}>
            <SpecEditor
              key={selectedTask.id}
              repo={repo}
              task={selectedTask}
              onClose={closeSpec}
              onHandover={handleHandover}
              inline
            />
          </div>
        )}
      </div>
    </main>
  );
}
