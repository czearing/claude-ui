import type { Task, TaskStatus } from '@/utils/tasks.types';

export type ColumnProps = {
  columnId: TaskStatus;
  label: string;
  tasks: Task[];
  accentColor: string;
  isAutomated?: boolean;
  onOpenDetail: (id: string) => void;
  className?: string;
};
