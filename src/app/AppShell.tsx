"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Backlog } from "@/components/Board/Backlog";
import { Board } from "@/components/Board/Board";
import { SpecEditor } from "@/components/Editor/SpecEditor";
import { Sidebar, type View } from "@/components/Layout/Sidebar";
import { TopBar } from "@/components/Layout/TopBar";
import { useHandoverTask, useTasks } from "@/hooks/useTasks";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import type { Task } from "@/utils/tasks.types";
import styles from "./AppShell.module.css";

const MIN_LEFT = 320;
const MIN_RIGHT = 340;
const DEFAULT_LEFT_WIDTH = 480;
const STORAGE_KEY = "split-pane-left-width";

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (n >= MIN_LEFT) {
        return n;
      }
    }
  } catch {
    // localStorage unavailable (SSR / private browsing)
  }
  return DEFAULT_LEFT_WIDTH;
}

function storeWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // ignore
  }
}

interface AppShellProps {
  repoId: string;
  view: View;
}

export function AppShell({ repoId, view: currentView }: AppShellProps) {
  const { data: tasks = [] } = useTasks(repoId);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const router = useRouter();
  const handoverTask = useHandoverTask(repoId);

  useTasksSocket();

  const contentRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const widthRef = useRef(DEFAULT_LEFT_WIDTH);

  const agentActive = tasks.some((t) => t.status === "In Progress");

  function handleNewTask() {
    router.push(`/repos/${repoId}/backlog`);
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

  const handleSelectTask = useCallback((task: Task) => {
    const w = readStoredWidth();
    widthRef.current = w;
    setLeftWidth(w);
    setSelectedTask(task);
  }, []);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const contentEl = contentRef.current;
    const leftEl = leftRef.current;
    if (!contentEl || !leftEl) {
      return;
    }

    contentEl.setAttribute("data-resizing", "true");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const rect = contentEl.getBoundingClientRect();
      const next = Math.max(
        MIN_LEFT,
        Math.min(ev.clientX - rect.left, rect.width - MIN_RIGHT),
      );
      widthRef.current = next;
      leftEl.style.width = `${next}px`;
    };

    const onUp = () => {
      contentEl.removeAttribute("data-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setLeftWidth(widthRef.current);
      storeWidth(widthRef.current);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div className={styles.shell}>
      <Sidebar
        repoId={repoId}
        currentView={currentView}
        agentActive={agentActive}
      />

      <main className={styles.main}>
        <TopBar repoId={repoId} currentView={currentView} onNewTask={handleNewTask} />

        <div ref={contentRef} className={styles.content}>
          <div
            ref={leftRef}
            className={styles.left}
            style={{ width: selectedTask ? `${leftWidth}px` : "100%" }}
          >
            {currentView === "Board" ? (
              <Board
                repoId={repoId}
                tasks={tasks.filter((t) => t.status !== "Backlog")}
                onSelectTask={handleSelectTask}
                onHandover={handleHandover}
              />
            ) : (
              <Backlog
                repoId={repoId}
                onSelectTask={handleSelectTask}
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
