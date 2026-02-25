"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Code, FileText, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { useState } from "react";

import { useCreateTask } from "@/hooks/useTasks";
import type { Priority, TaskType } from "@/utils/tasks.types";
import type { NewIssueModalProps } from "./NewIssueModal.types";
import styles from "./NewIssueModal.module.css";

export function NewIssueModal({ open, onClose }: NewIssueModalProps) {
  const { mutate: createTask } = useCreateTask();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("Spec");
  const [priority, setPriority] = useState<Priority>("Medium");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createTask(
      { title: title.trim(), type, priority, status: "Backlog" },
      {
        onSuccess: () => {
          setTitle("");
          setType("Spec");
          setPriority("Medium");
          onClose();
        },
      },
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay}>
          <Dialog.Content className={styles.modal}>
            <div className={styles.header}>
              <Dialog.Title className={styles.title}>New Issue</Dialog.Title>
              <Dialog.Close asChild>
                <button className={styles.closeButton} aria-label="Close">
                  <X size={20} />
                </button>
              </Dialog.Close>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label}>Title</label>
                <input
                  autoFocus
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  className={styles.input}
                />
              </div>

              <div className={styles.row}>
                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={styles.label}>Type</label>
                  <div className={styles.typeToggle}>
                    {(["Spec", "Develop"] as TaskType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={clsx(
                          styles.typeButton,
                          type === t && styles.typeButtonActive,
                        )}
                      >
                        {t === "Spec" ? (
                          <FileText size={14} />
                        ) : (
                          <Code size={14} />
                        )}
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.field} style={{ flex: 1 }}>
                  <label className={styles.label}>Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Priority)}
                    className={styles.select}
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className={styles.formFooter}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className={styles.submitButton}
                >
                  Create Issue
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
