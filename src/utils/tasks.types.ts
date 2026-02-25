// src/utils/tasks.types.ts
export type TaskStatus =
  | "Backlog"
  | "Not Started"
  | "In Progress"
  | "Review"
  | "Done";
export type Priority = "Low" | "Medium" | "High" | "Urgent";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  spec: string; // Lexical editor state JSON
  repoId: string; // which repo this task belongs to
  sessionId?: string; // linked Claude PTY session
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  archivedAt?: string; // ISO timestamp, set when status → "Done"
}

export type CreateTaskInput = Pick<Task, "title" | "repoId"> & {
  status?: TaskStatus;
  priority?: Priority;
};
export type UpdateTaskInput = Partial<
  Pick<
    Task,
    "title" | "status" | "priority" | "spec" | "sessionId" | "archivedAt"
  >
>;

export interface Repo {
  id: string; // stable UUID
  name: string; // user-defined display name
  path: string; // absolute path on disk
  createdAt: string; // ISO 8601
}

export type CreateRepoInput = Pick<Repo, "name" | "path">;
export type UpdateRepoInput = Partial<Pick<Repo, "name" | "path">>;
