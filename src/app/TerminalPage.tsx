"use client";

import { useState } from "react";

import { Terminal } from "@/components";
import { useTerminalSocket } from "@/hooks/useTerminalSocket";
import type { ClaudeStatus } from "@/hooks/useTerminalSocket.types";
import styles from "./TerminalPage.module.css";
import type { TerminalPageState } from "./TerminalPage.types";

type TerminalPageProps = {
  sessionId: string;
  onStatus?: (status: ClaudeStatus) => void;
};

export const TerminalPage = ({ sessionId, onStatus }: TerminalPageProps) => {
  const [xterm, setXterm] = useState<TerminalPageState["xterm"]>(null);

  useTerminalSocket(xterm, sessionId, onStatus);

  return (
    <div className={styles.page}>
      <Terminal onReady={setXterm} />
    </div>
  );
};
