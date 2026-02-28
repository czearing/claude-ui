import { useRef, useState } from "react";

const MIN_LEFT = 320;
const MIN_RIGHT = 340;
const DEFAULT_LEFT_WIDTH = 480;
const STORAGE_KEY = "split-pane-left-width";

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const n = parseInt(raw, 10);
      if (n >= MIN_LEFT) {
        return n;
      }
    }
  } catch {
    // localStorage unavailable (SSR / private browsing)
  }
  return DEFAULT_LEFT_WIDTH;
}

function storeWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // ignore
  }
}

export function useSplitPane() {
  const contentRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const widthRef = useRef(DEFAULT_LEFT_WIDTH);
  // Cache the stored width so openPane() doesn't hit localStorage every time.
  const storedWidthRef = useRef<number | null>(null);

  function openPane() {
    storedWidthRef.current ??= readStoredWidth();
    const w = storedWidthRef.current;
    widthRef.current = w;
    setLeftWidth(w);
  }

  function handleDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const contentEl = contentRef.current;
    const leftEl = leftRef.current;
    if (!contentEl || !leftEl) {
      return;
    }

    contentEl.setAttribute("data-resizing", "true");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const rect = contentEl.getBoundingClientRect();
      const next = Math.max(
        MIN_LEFT,
        Math.min(ev.clientX - rect.left, rect.width - MIN_RIGHT),
      );
      widthRef.current = next;
      leftEl.style.width = `${next}px`;
    };

    const onUp = () => {
      contentEl.removeAttribute("data-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      storedWidthRef.current = widthRef.current;
      setLeftWidth(widthRef.current);
      storeWidth(widthRef.current);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return { contentRef, leftRef, leftWidth, openPane, handleDividerMouseDown };
}
