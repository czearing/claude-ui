'use client';

import { useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';

import { useTaskMutations } from '@/hooks/useTaskMutations';
import styles from './CreateTaskDialog.module.css';
import type { CreateTaskDialogProps } from './CreateTaskDialog.types';

export function CreateTaskDialog({
  open,
  onClose,
  className,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const { createTask, isCreating } = useTaskMutations();
  const titleRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setTitle('');
    setDescription('');
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      resetForm();
      onClose();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || isCreating) {return;}
    await createTask({ title: trimmed, description: description.trim() || undefined });
    resetForm();
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Enter' && !e.shiftKey && title.trim()) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay}>
          <Dialog.Content
            className={clsx(styles.dialog, className)}
            aria-labelledby="create-task-title"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              titleRef.current?.focus();
            }}
          >
            <div className={styles.header}>
              <Dialog.Title
                id="create-task-title"
                className={styles.title}
              >
                New Task
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className={styles.closeButton}
                  aria-label="Close dialog"
                >
                  <X size={16} weight="bold" />
                </button>
              </Dialog.Close>
            </div>
            <form
              className={styles.body}
              onSubmit={(e) => void handleSubmit(e)}
              onKeyDown={handleKeyDown}
            >
              <div className={styles.field}>
                <label htmlFor="task-title" className={styles.label}>
                  Title <span className={styles.required} aria-hidden="true">*</span>
                </label>
                <input
                  ref={titleRef}
                  id="task-title"
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Fix login bug"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="task-description" className={styles.label}>
                  Description
                </label>
                <textarea
                  id="task-description"
                  className={styles.textarea}
                  placeholder="Optional details..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </div>
              <div className={styles.footer}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={() => {
                    resetForm();
                    onClose();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={!title.trim() || isCreating}
                >
                  {isCreating ? 'Creating...' : 'Create task'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
