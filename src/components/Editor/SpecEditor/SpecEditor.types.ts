import type { Task } from "@/utils/tasks.types";

export interface SpecEditorProps {
  repo: string;
  task: Task | null;
  onClose: () => void;
  onHandover?: (taskId: string) => void;
  inline?: boolean;
}
