// src/app/repos/[repoId]/session/[sessionId]/SessionPage.tsx
"use client";

import { use, useState } from "react";
import Link from "next/link";

import { TerminalPage } from "@/app/TerminalPage";
import { StatusIndicator } from "@/components";
import type { ClaudeStatus } from "@/hooks/useTerminalSocket.types";
import { useTasks, useUpdateTask } from "@/hooks/useTasks";
import styles from "./SessionPage.module.css";

type SessionPageProps = {
  params: Promise<{ repoId: string; sessionId: string }>;
};

export const SessionPage = ({ params }: SessionPageProps) => {
  const { repoId, sessionId } = use(params);
  const [status, setStatus] = useState<ClaudeStatus>("connecting");
  const { data: tasks = [] } = useTasks(repoId);
  const { mutate: updateTask } = useUpdateTask(repoId);

  const task = tasks.find((t) => t.sessionId === sessionId);

  function handleStatus(newStatus: ClaudeStatus) {
    setStatus(newStatus);
    if (
      (newStatus === "thinking" || newStatus === "typing") &&
      task?.status === "Review"
    ) {
      updateTask({ id: task.id, status: "In Progress" });
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link
          href={`/repos/${repoId}`}
          className={styles.backLink}
          aria-label="Back to board"
        >
          ← Back
        </Link>
        <StatusIndicator status={status} />
      </header>
      <div className={styles.terminal}>
        <TerminalPage sessionId={sessionId} onStatus={handleStatus} />
      </div>
    </div>
  );
};
