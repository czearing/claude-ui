import type { Task } from "@/utils/tasks.types";

export interface SpecEditorProps {
  repoId: string;
  task: Task | null;
  onClose: () => void;
  inline?: boolean;
}
