"use client";

import { useState } from "react";

import { Terminal } from "@/components";
import { useTerminalSocket } from "@/hooks/useTerminalSocket";
import styles from "./TerminalPage.module.css";
import type { TerminalPageState } from "./TerminalPage.types";

export const TerminalPage = () => {
  const [xterm, setXterm] = useState<TerminalPageState["xterm"]>(null);

  useTerminalSocket(xterm);

  return (
    <div className={styles.page}>
      <Terminal onReady={setXterm} />
    </div>
  );
};
