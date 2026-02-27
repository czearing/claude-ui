// src/app/repos/[repo]/session/[sessionId]/SessionPage.tsx
"use client";

import { use, useState } from "react";
import Link from "next/link";

import { TerminalPage } from "@/app/TerminalPage";
import { StatusIndicator } from "@/components";
import { useTasksSocket } from "@/hooks/useTasksSocket";
import type { ClaudeStatus } from "@/hooks/useTerminalSocket.types";
import styles from "./SessionPage.module.css";

type SessionPageProps = {
  params: Promise<{ repo: string; sessionId: string }>;
};

export const SessionPage = ({ params }: SessionPageProps) => {
  const { repo, sessionId } = use(params);
  const [status, setStatus] = useState<ClaudeStatus>("connecting");
  useTasksSocket();
  function handleStatus(newStatus: ClaudeStatus) {
    setStatus(newStatus);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link
          href={`/repos/${repo}`}
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
