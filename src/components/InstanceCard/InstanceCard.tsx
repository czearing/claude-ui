"use client";

import { formatRelativeDate } from "../../utils/formatRelativeDate";

import styles from "./InstanceCard.module.css";
import type { InstanceCardProps } from "./InstanceCard.types";

export const InstanceCard = ({
  session,
  onOpen,
  onDelete,
}: InstanceCardProps) => {
  function handleDelete(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    onDelete(session.id);
  }

  return (
    <article className={styles.card}>
      <button
        type="button"
        className={styles.openButton}
        onClick={() => onOpen(session)}
        aria-label={`Open ${session.name}`}
      >
        <div className={styles.body}>
          <h2 className={styles.name}>{session.name}</h2>
          <p className={styles.date}>{formatRelativeDate(session.createdAt)}</p>
        </div>
      </button>
      <button
        type="button"
        className={styles.deleteButton}
        onClick={handleDelete}
        aria-label={`Delete ${session.name}`}
      >
        ×
      </button>
    </article>
  );
};
