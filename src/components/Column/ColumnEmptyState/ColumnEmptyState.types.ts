import type { TaskStatus } from '@/utils/tasks.types';

export type ColumnEmptyStateProps = {
  status: TaskStatus;
  className?: string;
};
