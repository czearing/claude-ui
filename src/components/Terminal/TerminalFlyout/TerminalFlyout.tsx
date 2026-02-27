"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import styles from "./TerminalFlyout.module.css";
import type { TerminalFlyoutProps } from "./TerminalFlyout.types";

const TerminalPage = dynamic(
  () => import("@/app/TerminalPage").then((m) => m.TerminalPage),
  { ssr: false },
);

const STORAGE_KEY = "terminal-flyout-height";
const DEFAULT_HEIGHT = 360;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 800;
const MAX_SCREEN_RATIO = 0.8;

function getScreenMax(): number {
  if (typeof window === "undefined") { return MAX_HEIGHT; }
  return Math.min(
    MAX_HEIGHT,
    Math.floor(window.innerHeight * MAX_SCREEN_RATIO),
  );
}

function clampHeight(h: number): number {
  return Math.min(getScreenMax(), Math.max(MIN_HEIGHT, h));
}

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (!isNaN(n)) { return clampHeight(n); }
    }
  } catch {
    // localStorage unavailable (SSR / private browsing)
  }
  return clampHeight(DEFAULT_HEIGHT);
}

function storeHeight(h: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(h));
  } catch {
    // ignore
  }
}

export function TerminalFlyout({
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseTab,
  onClose,
}: TerminalFlyoutProps) {
  const [height, setHeight] = useState(() => readStoredHeight());
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const heightRef = useRef(height);

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    startY.current = e.clientY;
    startHeight.current = heightRef.current;
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) { return; }
      const delta = startY.current - e.clientY;
      const next = clampHeight(startHeight.current + delta);
      heightRef.current = next;
      setHeight(next);
    };
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        storeHeight(heightRef.current);
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      setHeight((h) => {
        const clamped = clampHeight(h);
        heightRef.current = clamped;
        return clamped;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
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
