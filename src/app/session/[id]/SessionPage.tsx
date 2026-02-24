"use client";

import { use, useState } from "react";
import Link from "next/link";

import { useSessionStore } from "@/hooks/useSessionStore";
import { TerminalPage } from "@/app/TerminalPage";
import { StatusIndicator } from "@/components";
import type { ClaudeStatus } from "@/hooks/useTerminalSocket.types";

import styles from "./SessionPage.module.css";

type SessionPageProps = {
  params: Promise<{ id: string }>;
};

export const SessionPage = ({ params }: SessionPageProps) => {
  const { id } = use(params);
  const { sessions } = useSessionStore();
  const session = sessions.find((s) => s.id === id);
  const sessionName = session?.name ?? "Instance";
  const [status, setStatus] = useState<ClaudeStatus>("connecting");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.backLink} aria-label="Back to instances">
          ← Back
        </Link>
        <span className={styles.sessionName}>{sessionName}</span>
        <StatusIndicator status={status} />
      </header>
      <div className={styles.terminal}>
        <TerminalPage sessionId={id} onStatus={setStatus} />
      </div>
    </div>
  );
};
