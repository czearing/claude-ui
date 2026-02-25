import type { Task, TaskStatus } from "@/utils/tasks.types";

export interface ColumnProps {
  status: TaskStatus;
  tasks: Task[];
  onSelectTask: (task: Task) => void;
  onRemoveTask?: (id: string) => void;
  onRecall?: (id: string) => void;
  onHandover?: (taskId: string) => void;
  isDropDisabled?: boolean;
}
