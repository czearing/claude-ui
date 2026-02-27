"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import styles from "./TerminalFlyout.module.css";
import type { TerminalFlyoutProps } from "./TerminalFlyout.types";

const TerminalPage = dynamic(
  () => import("@/app/TerminalPage").then((m) => m.TerminalPage),
  { ssr: false },
);

const DEFAULT_HEIGHT = 360;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 800;

export function TerminalFlyout({
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseTab,
  onClose,
}: TerminalFlyoutProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) {return;}
      const delta = startY.current - e.clientY;
      const next = Math.min(
        MAX_HEIGHT,
        Math.max(MIN_HEIGHT, startHeight.current + delta),
      );
      setHeight(next);
    };
    const onMouseUp = () => {
      dragging.current = false;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {onClose();}
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={styles.flyout}
      style={{ height }}
      data-testid="terminal-flyout"
    >
      <div
        className={styles.resizeHandle}
        onMouseDown={handleResizeMouseDown}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
      />
      <div className={styles.tabBar} role="tablist">
        {sessions.map((s) => (
          <div
            key={s.sessionId}
            className={styles.tab}
            role="tab"
            aria-selected={s.sessionId === activeSessionId}
            data-active={s.sessionId === activeSessionId}
            onClick={() => onSelectSession(s.sessionId)}
            title={s.title || "Untitled"}
          >
            <span
              className={styles.tabDot}
              data-status={s.status ?? ""}
              aria-hidden="true"
            />
            <span className={styles.tabTitle}>{s.title || "Untitled"}</span>
            <button
              className={styles.tabClose}
              aria-label={`Close ${s.title || "Untitled"}`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(s.sessionId);
              }}
            >
              &#x2715;
            </button>
          </div>
        ))}
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close terminal"
        >
          &#x2715;
        </button>
      </div>
      <div className={styles.terminal} role="tabpanel">
        <TerminalPage key={activeSessionId} sessionId={activeSessionId} />
      </div>
    </div>
  );
}
