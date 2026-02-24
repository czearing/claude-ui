"use client";

import { useState } from "react";

import type { Terminal as XTerm } from "@xterm/xterm";

import { Terminal } from "@/components";
import { useTerminalSocket } from "@/hooks/useTerminalSocket";

import styles from "./TerminalPage.module.css";

export const TerminalPage = () => {
  const [xterm, setXterm] = useState<XTerm | null>(null);

  useTerminalSocket(xterm);

  return (
    <div className={styles.page}>
      <Terminal onReady={setXterm} />
    </div>
  );
};
