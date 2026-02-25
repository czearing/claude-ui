// src/utils/tasks.types.ts
export type TaskStatus =
  | "Backlog"
  | "Not Started"
  | "In Progress"
  | "Review"
  | "Done";
export type TaskType = "Spec" | "Develop";
export type Priority = "Low" | "Medium" | "High" | "Urgent";

export interface Task {
  id: string;
  title: string;
  type: TaskType;
  status: TaskStatus;
  priority: Priority;
  spec: string; // Lexical editor state JSON
  sessionId?: string; // linked Claude PTY session
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export type CreateTaskInput = Pick<Task, "title" | "type" | "priority"> & {
  status?: TaskStatus;
};
export type UpdateTaskInput = Partial<
  Pick<Task, "title" | "type" | "status" | "priority" | "spec" | "sessionId">
>;
