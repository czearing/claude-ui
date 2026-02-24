export type TaskStatus =
  | "backlog"
  | "not_started"
  | "in_progress"
  | "review"
  | "done";

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  columnOrder: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  agentPid?: number;
  currentAction?: string;
  errorMessage?: string;
  tags?: string[];
}
