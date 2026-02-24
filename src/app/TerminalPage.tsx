"use client";

import { useState } from "react";

import { Terminal } from "@/components";
import { useTerminalSocket } from "@/hooks/useTerminalSocket";
import styles from "./TerminalPage.module.css";
import type { TerminalPageState } from "./TerminalPage.types";

type TerminalPageProps = {
  sessionId: string;
};

export const TerminalPage = ({ sessionId }: TerminalPageProps) => {
  const [xterm, setXterm] = useState<TerminalPageState["xterm"]>(null);

  useTerminalSocket(xterm, sessionId);

  return (
    <div className={styles.page}>
      <Terminal onReady={setXterm} />
    </div>
  );
};
