// src/components/Playbooks/PlaybookList/PlaybookList.tsx
"use client";

import { Plus } from "@phosphor-icons/react";
import clsx from "clsx";

import styles from "./PlaybookList.module.css";
import type { PlaybookListProps } from "./PlaybookList.types";

export function PlaybookList({
  playbooks,
  selectedName,
  onSelect,
  onNew,
  className,
}: PlaybookListProps) {
  return (
    <div className={clsx(styles.list, className)}>
      <div className={styles.header}>
        <span className={styles.title}>Playbooks</span>
        <button
          className={styles.newButton}
          onClick={onNew}
          aria-label="New playbook"
        >
          <Plus size={12} weight="bold" />
          New
        </button>
      </div>
      <div className={styles.items}>
        {playbooks.length === 0 && (
          <p className={styles.empty}>No playbooks yet.</p>
        )}
        {playbooks.map(({ name }) => (
          <button
            key={name}
            className={clsx(
              styles.item,
              selectedName === name && styles.itemSelected,
            )}
            onClick={() => onSelect(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
