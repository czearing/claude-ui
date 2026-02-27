// src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/AddRepoDialog.tsx
"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { useCreateRepo } from "@/hooks/useRepos";
import styles from "./AddRepoDialog.module.css";
import type { AddRepoDialogProps } from "./AddRepoDialog.types";

export function AddRepoDialog({
  open,
  onClose,
  onCreated,
}: AddRepoDialogProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const createRepo = useCreateRepo();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createRepo.mutate(
      { name: name.trim(), path: path.trim() },
      {
        onSuccess: (repo) => {
          setName("");
          setPath("");
          onCreated(repo.name);
        },
      },
    );
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setName("");
      setPath("");
      createRepo.reset();
      onClose();
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>Add repo</Dialog.Title>
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="repo-name" className={styles.label}>
                Name
              </label>
              <input
                id="repo-name"
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Frontend"
                required
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="repo-path" className={styles.label}>
                Path
              </label>
              <input
                id="repo-path"
                className={styles.input}
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/Users/you/code/my-app"
                required
              />
              {createRepo.error && (
                <span className={styles.error}>{createRepo.error.message}</span>
              )}
            </div>
            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className={styles.submit}
                disabled={createRepo.isPending}
              >
                {createRepo.isPending ? "Adding…" : "Add repo"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
