'use client';

import { clsx } from 'clsx';

import { useElapsedTime } from '@/hooks/useElapsedTime';
import styles from './TaskCardProgress.module.css';
import type { TaskCardProgressProps } from './TaskCardProgress.types';

export function TaskCardProgress({
  currentAction,
  startedAt,
  className,
}: TaskCardProgressProps) {
  const elapsed = useElapsedTime(startedAt);

  return (
    <div className={clsx(styles.progress, className)}>
      <div className={styles.header}>
        <span className={styles.action} title={currentAction ?? 'Working...'}>
          {currentAction ?? 'Working...'}
        </span>
        <span className={styles.elapsed}>{elapsed}</span>
      </div>
      <div className={styles.barTrack} role="progressbar" aria-label="Task in progress">
        <div className={styles.barFill} />
      </div>
    </div>
  );
}
