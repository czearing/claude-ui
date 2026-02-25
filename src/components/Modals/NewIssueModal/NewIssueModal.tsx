"use client";

import { useState } from "react";
import { X } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";

import { useCreateTask } from "@/hooks/useTasks";
import styles from "./NewIssueModal.module.css";
import type { NewIssueModalProps } from "./NewIssueModal.types";

export function NewIssueModal({ repoId, open, onClose }: NewIssueModalProps) {
  const { mutate: createTask } = useCreateTask(repoId);
  const [title, setTitle] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      return;
    }
    createTask(
      { title: title.trim(), status: "Backlog" },
      {
        onSuccess: () => {
          setTitle("");
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
