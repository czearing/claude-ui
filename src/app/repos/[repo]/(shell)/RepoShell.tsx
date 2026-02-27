"use client";

import { useParams, usePathname } from "next/navigation";

import { AppShell } from "@/app/AppShell";
import { Sidebar, type View } from "@/components/Layout/Sidebar";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import styles from "./RepoShell.module.css";

function getView(pathname: string): View {
  if (pathname.includes("/agents")) {
    return "Agents";
  }
  if (pathname.includes("/skills")) {
    return "Skills";
  }
  if (pathname.includes("/archive")) {
    return "Archive";
  }
  if (pathname.includes("/tasks")) {
    return "Tasks";
  }
  return "Board";
}

export function RepoShell({
  repo,
  children,
}: {
  repo: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useParams();
  const currentView = getView(pathname);
  const selectedTaskId =
    typeof params.taskId === "string" ? params.taskId : undefined;

  useTasksSocket();

  return (
    <div className={styles.shell}>
      <Sidebar repo={repo} currentView={currentView} />
      {currentView === "Board" || currentView === "Tasks" ? (
        <AppShell
          repo={repo}
          view={currentView}
          selectedTaskId={selectedTaskId}
        />
      ) : (
        <div className={styles.main}>{children}</div>
      )}
    </div>
  );
}
