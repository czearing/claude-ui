import type { Task, TaskStatus } from '@/utils/tasks.types';

export interface ColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onSelectTask: (task: Task) => void;
}
