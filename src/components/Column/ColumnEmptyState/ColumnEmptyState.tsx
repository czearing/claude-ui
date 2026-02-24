import { clsx } from 'clsx';

import styles from './ColumnEmptyState.module.css';
import type { ColumnEmptyStateProps } from './ColumnEmptyState.types';

const EMPTY_MESSAGES: Record<string, string> = {
  backlog: 'Add your first spec to get started',
  not_started: 'Drag a task here to queue it',
  in_progress: 'No active agents',
  review: 'Nothing to review',
  done: 'No completed tasks yet',
};

export function ColumnEmptyState({ status, className }: ColumnEmptyStateProps) {
  return (
    <p className={clsx(styles.empty, className)}>
      {EMPTY_MESSAGES[status] ?? 'No tasks'}
    </p>
  );
}
