"use client";

import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import styles from "./Terminal.module.css";
import type { TerminalProps } from "./Terminal.types";

export const Terminal = ({ onReady }: TerminalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "monospace",
      theme: { background: "#0d1117" },
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);
    fitAddon.fit();
    onReady(xterm);

    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      onReady(null);
      xterm.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onReady is a stable setState setter
  }, []);

  return <div ref={containerRef} data-testid="terminal-container" className={styles.container} />;
};
