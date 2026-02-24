import type { Task, TaskStatus } from '@/utils/tasks.types';

export type BoardProps = {
  tasks: Task[];
  onOpenDetail: (id: string) => void;
  onMoveTask: (taskId: string, newStatus: TaskStatus, newOrder: number) => void;
  className?: string;
};
