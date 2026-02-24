import type { Task } from '@/utils/tasks.types';

export interface SpecEditorProps {
  task: Task | null;
  onClose: () => void;
}
