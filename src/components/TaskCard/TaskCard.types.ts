import type { Task } from '@/utils/tasks.types';

export type TaskCardProps = {
  task: Task;
  onOpenDetail: (id: string) => void;
  className?: string;
};
