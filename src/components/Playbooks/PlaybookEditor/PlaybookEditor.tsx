// src/components/Playbooks/PlaybookEditor/PlaybookEditor.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import clsx from "clsx";

import { LexicalEditor } from "@/components/Editor/LexicalEditor";

import styles from "./PlaybookEditor.module.css";
import type { PlaybookEditorProps } from "./PlaybookEditor.types";

export function PlaybookEditor({
  name,
  content,
  onChange,
  onRename,
  onDelete,
  className,
}: PlaybookEditorProps) {
  const [localName, setLocalName] = useState(name);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync localName when the selected playbook changes externally
  useEffect(() => {
    setLocalName(name);
  }, [name]);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function handleContentChange(val: string) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => onChange(val), 800);
  }

  function commitRename() {
    const trimmed = localName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    } else {
      setLocalName(name);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    }
    if (e.key === "Escape") {
      setLocalName(name);
      e.currentTarget.blur();
    }
  }

  return (
    <div className={clsx(styles.editor, className)}>
      <div className={styles.toolbar}>
        <input
          className={styles.nameInput}
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={handleKeyDown}
          aria-label="Playbook name"
          spellCheck={false}
        />
        <button
          className={styles.deleteButton}
          onClick={onDelete}
          aria-label="Delete playbook"
        >
          <Trash size={14} />
        </button>
      </div>
      <div className={styles.editorBody}>
        <LexicalEditor
          key={name}
          format="markdown"
          value={content}
          onChange={handleContentChange}
          placeholder="Describe how Claude should behave for this type of task…"
        />
      </div>
    </div>
  );
}
