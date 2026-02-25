import type { Task } from "@/utils/tasks.types";

export interface TaskCardProps {
  task: Task;
  onSelect: (task: Task) => void;
  onRemove?: (id: string) => void;
  selected?: boolean;
}
