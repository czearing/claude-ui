import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createTask as apiCreateTask,
  deleteTask as apiDeleteTask,
  patchTask as apiPatchTask,
} from '@/utils/tasks.client';
import type { Task } from '@/utils/tasks.types';
import type {
  CancelAgentVars,
  CreateTaskVars,
  DeleteTaskVars,
  MoveTaskVars,
  PatchTaskVars,
  UpdateTitleVars,
  UseTaskMutationsResult,
} from './useTaskMutations.types';

const TASKS_KEY = ['tasks'] as const;

type MutationContext = { previous: Task[] | undefined };

function usePreviousSnapshot() {
  const queryClient = useQueryClient();
  return async (): Promise<MutationContext> => {
    await queryClient.cancelQueries({ queryKey: TASKS_KEY });
    const previous = queryClient.getQueryData<Task[]>(TASKS_KEY);
    return { previous };
  };
}

function useRollback() {
  const queryClient = useQueryClient();
  return (_err: Error, _vars: unknown, context: MutationContext | undefined) => {
    queryClient.setQueryData(TASKS_KEY, context?.previous);
  };
}

function useSettle() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: TASKS_KEY });
  };
}

export function useTaskMutations(): UseTaskMutationsResult {
  const queryClient = useQueryClient();
  const snapshot = usePreviousSnapshot();
  const rollback = useRollback();
  const settle = useSettle();

  const createTaskMutation = useMutation<Task, Error, CreateTaskVars, MutationContext>({
    mutationFn: (vars) => apiCreateTask(vars),
    onMutate: async (vars) => {
      const ctx = await snapshot();
      const tempId = `temp-${Date.now()}`;
      const tempTask: Task = {
        id: tempId,
        title: vars.title,
        description: vars.description,
        status: 'backlog',
        columnOrder: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) =>
        old ? [...old, tempTask] : [tempTask],
      );
      return ctx;
    },
    onSuccess: (newTask, vars, context) => {
      const tempCreatedAt = context
        ? queryClient
            .getQueryData<Task[]>(TASKS_KEY)
            ?.find((t) => t.title === vars.title && t.id.startsWith('temp-'))
            ?.id
        : undefined;
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => {
        if (!old) {return [newTask];}
        const tempIndex = old.findIndex(
          (t) => t.id === tempCreatedAt || (t.id.startsWith('temp-') && t.title === vars.title),
        );
        if (tempIndex === -1) {return [...old, newTask];}
        const next = [...old];
        next[tempIndex] = newTask;
        return next;
      });
    },
    onError: rollback,
    onSettled: settle,
  });

  const moveTask = useMutation<Task, Error, MoveTaskVars, MutationContext>({
    mutationFn: ({ taskId, status, columnOrder }) =>
      apiPatchTask(
        taskId,
        columnOrder !== undefined ? { status, columnOrder } : { status },
      ),
    onMutate: async (vars) => {
      const ctx = await snapshot();
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => {
        if (!old) {return old;}
        return old.map((t) => {
          if (t.id !== vars.taskId) {return t;}
          return {
            ...t,
            status: vars.status,
            ...(vars.columnOrder !== undefined
              ? { columnOrder: vars.columnOrder }
              : {}),
          };
        });
      });
      return ctx;
    },
    onError: rollback,
    onSettled: settle,
  });

  const updateTitle = useMutation<Task, Error, UpdateTitleVars, MutationContext>({
    mutationFn: ({ taskId, title }) => apiPatchTask(taskId, { title }),
    onMutate: async (vars) => {
      const ctx = await snapshot();
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => {
        if (!old) {return old;}
        return old.map((t) =>
          t.id === vars.taskId ? { ...t, title: vars.title } : t,
        );
      });
      return ctx;
    },
    onError: rollback,
    onSettled: settle,
  });

  const deleteTask = useMutation<void, Error, DeleteTaskVars, MutationContext>({
    mutationFn: ({ taskId }) => apiDeleteTask(taskId),
    onMutate: async (vars) => {
      const ctx = await snapshot();
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) =>
        old ? old.filter((t) => t.id !== vars.taskId) : [],
      );
      return ctx;
    },
    onError: rollback,
    onSettled: settle,
  });

  const cancelAgent = useMutation<Task, Error, CancelAgentVars, MutationContext>({
    mutationFn: ({ taskId }) => apiPatchTask(taskId, { status: 'backlog' }),
    onMutate: async (vars) => {
      const ctx = await snapshot();
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => {
        if (!old) {return old;}
        return old.map((t) =>
          t.id === vars.taskId ? { ...t, status: 'backlog' as const } : t,
        );
      });
      return ctx;
    },
    onError: rollback,
    onSettled: settle,
  });

  const patchTaskMutation = useMutation<Task, Error, PatchTaskVars, MutationContext>({
    mutationFn: ({ id, data }) => apiPatchTask(id, data),
    onMutate: async (vars) => {
      const ctx = await snapshot();
      queryClient.setQueryData<Task[]>(TASKS_KEY, (old) => {
        if (!old) {return old;}
        return old.map((t) => (t.id === vars.id ? { ...t, ...vars.data } : t));
      });
      return ctx;
    },
    onError: rollback,
    onSettled: settle,
  });

  function createTask(vars: CreateTaskVars): Promise<Task> {
    return createTaskMutation.mutateAsync(vars);
  }

  function patchTask(vars: PatchTaskVars): Promise<Task> {
    return patchTaskMutation.mutateAsync(vars);
  }

  return {
    createTask,
    isCreating: createTaskMutation.isPending,
    moveTask,
    updateTitle,
    deleteTask,
    cancelAgent,
    patchTask,
    isPatching: patchTaskMutation.isPending,
  };
}
