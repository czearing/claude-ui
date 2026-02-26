// src/components/Skills/SkillEditor/SkillEditor.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { clsx } from "clsx";

import { LexicalEditor } from "@/components/Editor/LexicalEditor";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import styles from "./SkillEditor.module.css";
import type { SkillEditorProps } from "./SkillEditor.types";

export function SkillEditor({
  name,
  description,
  content,
  onChange,
  onRename,
  onDelete,
  className,
}: SkillEditorProps) {
  const [localName, setLocalName] = useState(name);
  const [localDescription, setLocalDescription] = useState(description);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const editorBodyRef = useRef<HTMLDivElement>(null);
  const [scheduleSave] = useDebouncedCallback(
    (newDescription: string, newContent: string) =>
      onChange(newDescription, newContent),
    300,
  );

  useEffect(() => {
    setLocalName(name);
  }, [name]);

  useEffect(() => {
    setLocalDescription(description);
  }, [description]);

  function handleDescriptionChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setLocalDescription(val);
    scheduleSave(val, content);
  }

  function handleContentChange(val: string) {
    // Skip if the editor round-tripped to the same markdown that was loaded.
    // Lexical's $convertToMarkdownString often appends a trailing newline while
    // the server trims content on PUT. After the first save, content === trimmed
    // but val === trimmed + "\n", so a naive === check triggers a phantom save
    // on every keystroke. Comparing trimmed values suppresses that noise.
    if (val === content || val.trim() === content) {
      return;
    }
    scheduleSave(localDescription, val);
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
    if (e.key === "ArrowDown") {
      e.preventDefault();
      descriptionRef.current?.focus();
    }
  }

  function handleDescriptionKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const ce =
        editorBodyRef.current?.querySelector<HTMLElement>("[contenteditable]");
      ce?.focus();
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
          aria-label="Skill name"
          spellCheck={false}
        />
        <button
          className={styles.deleteButton}
          onClick={onDelete}
          aria-label="Delete skill"
        >
          <Trash size={14} />
        </button>
      </div>
      <div className={styles.descriptionRow}>
        <input
          ref={descriptionRef}
          className={styles.descriptionInput}
          value={localDescription}
          onChange={handleDescriptionChange}
          onKeyDown={handleDescriptionKeyDown}
          placeholder="Describe when Claude should use this skill…"
          aria-label="Skill description"
          spellCheck={false}
        />
      </div>
      <div ref={editorBodyRef} className={styles.editorBody}>
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
