"use client";

import { useEffect, useRef, useState } from "react";
import { PaperPlaneTilt, Robot, X } from "@phosphor-icons/react";

import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";
import { useUpdateTask } from "@/hooks/useTasks";
import styles from "./SpecEditor.module.css";
import type { SpecEditorProps } from "./SpecEditor.types";
import { LexicalEditor } from "../LexicalEditor";

export function SpecEditor({
  repo,
  task,
  onClose,
  onHandover,
  inline,
}: SpecEditorProps) {
  const { mutate: updateTask, mutateAsync: updateTaskAsync } =
    useUpdateTask(repo);
  const [isHandingOver, setIsHandingOver] = useState(false);

  const [spec, setSpec] = useState(task?.spec ?? "");
  const [title, setTitle] = useState(task?.title ?? "");
  const titleRef = useRef<HTMLInputElement>(null);
  const [scheduleSpecSave, cancelSpecSave] = useDebouncedCallback(
    (markdown: string) => updateTask({ id: task?.id ?? "", spec: markdown }),
    300,
  );
  const [scheduleTitleSave, cancelTitleSave] = useDebouncedCallback(
    (val: string) => {
      if (val.trim()) {
        updateTask({ id: task?.id ?? "", title: val.trim() });
      }
    },
    600,
  );

  // Auto-focus the title when opening a new (untitled) task
  useEffect(() => {
    if (!task?.title) {
      titleRef.current?.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) {
    return null;
  }

  const isBacklog = task.status === "Backlog";
  const isReview = task.status === "Review";

  const handleSpecChange = (markdown: string) => {
    setSpec(markdown);
    // Skip if content hasn't actually changed (e.g. initial ContentLoader round-trip).
    if (markdown === (task?.spec ?? "")) {
      return;
    }
    scheduleSpecSave(markdown);
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTitle(val);
    scheduleTitleSave(val);
  };

  const handleHandover = async () => {
    setIsHandingOver(true);
    // flush immediately, awaiting the PATCH so handover POST reads latest spec
    cancelSpecSave();
    cancelTitleSave();
    try {
      await updateTaskAsync({
        id: task.id,
        spec,
        ...(title.trim() && { title: title.trim() }),
      });
    } catch {
      // spec save failed — proceed with handover using existing saved data
    }
    onHandover?.(task.id);
    onClose();
    setIsHandingOver(false);
  };

  return (
    <div className={`${styles.panel}${inline ? ` ${styles.panelInline}` : ""}`}>
      <div className={styles.editorArea}>
        <div className={styles.titleRow}>
          {isBacklog ? (
            <input
              ref={titleRef}
              className={styles.pageTitleInput}
              value={title}
              onChange={handleTitleChange}
              onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
              placeholder="New Title"
            />
          ) : (
            <h1 className={styles.pageTitle}>{task.title}</h1>
          )}
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
            tabIndex={-1}
          >
            <X size={16} />
          </button>
        </div>
        <LexicalEditor
          key={`${task.id}-${isBacklog ? "edit" : "read"}`}
          format="markdown"
          value={spec}
          onChange={isBacklog ? handleSpecChange : undefined}
          readOnly={!isBacklog}
          placeholder="Write a specification for this task…"
        />
      </div>

      {isReview && (
        <div className={styles.agentNotes}>
          <div className={styles.agentNotesTitle}>
            <Robot size={15} />
            <span>Agent Notes</span>
          </div>
          <p className={styles.agentNotesText}>
            Implementation complete. Review the changes in the terminal.
          </p>
          {task.sessionId && (
            <a
              href={`/repos/${repo}/session/${task.sessionId}`}
              className={styles.viewDiffButton}
              style={{ textDecoration: "none", display: "inline-block" }}
            >
              Open Terminal
            </a>
          )}
        </div>
      )}

      {isBacklog && (
        <div className={styles.footer}>
          <button
            className={styles.handoverButton}
            onClick={handleHandover}
            disabled={isHandingOver}
          >
            <PaperPlaneTilt size={15} />
            <span>{isHandingOver ? "Starting…" : "Handover to Claude"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
