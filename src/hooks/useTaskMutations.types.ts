import type { UseMutationResult } from '@tanstack/react-query';

import type { Task, TaskStatus } from '@/utils/tasks.types';

export type CreateTaskVars = {
  title: string;
  description?: string;
};

export type MoveTaskVars = {
  taskId: string;
  status: TaskStatus;
  columnOrder?: number;
};

export type UpdateTitleVars = {
  taskId: string;
  title: string;
};

export type DeleteTaskVars = {
  taskId: string;
};

export type CancelAgentVars = {
  taskId: string;
};

export type PatchTaskVars = {
  id: string;
  data: Partial<Task>;
};

type MutationContext = { previous: Task[] | undefined };

export type UseTaskMutationsResult = {
  createTask: (vars: CreateTaskVars) => Promise<Task>;
  isCreating: boolean;
  moveTask: UseMutationResult<Task, Error, MoveTaskVars, MutationContext>;
  updateTitle: UseMutationResult<Task, Error, UpdateTitleVars, MutationContext>;
  deleteTask: UseMutationResult<void, Error, DeleteTaskVars, MutationContext>;
  cancelAgent: UseMutationResult<Task, Error, CancelAgentVars, MutationContext>;
  patchTask: (vars: PatchTaskVars) => Promise<Task>;
  isPatching: boolean;
};
