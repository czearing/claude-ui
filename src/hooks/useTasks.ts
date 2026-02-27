// src/hooks/useTasks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateTaskInput,
  Task,
  UpdateTaskInput,
} from "@/utils/tasks.types";

function tasksKey(repo: string) {
  return ["tasks", repo] as const;
}

async function fetchTasks(repo: string): Promise<Task[]> {
  const res = await fetch(`/api/tasks?repo=${encodeURIComponent(repo)}`);
  if (!res.ok) {
    throw new Error("Failed to fetch tasks");
  }
  return res.json() as Promise<Task[]>;
}

export function useTasks<T = Task[]>(
  repo: string,
  select?: (data: Task[]) => T,
) {
  return useQuery({
    queryKey: tasksKey(repo),
    queryFn: () => fetchTasks(repo),
    enabled: Boolean(repo),
    staleTime: Infinity, // WebSocket keeps tasks fresh via setQueryData
    select,
  });
}

export function useCreateTask(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateTaskInput, "repo">) =>
      fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, repo }),
      }).then(async (r) => {
        if (!r.ok) {
          throw new Error("Failed to create task");
        }
        return r.json() as Promise<Task>;
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repo) }),
  });
}

export function useUpdateTask(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) =>
      fetch(`/api/tasks/${id}?repo=${encodeURIComponent(repo)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).then(async (r) => {
        if (!r.ok) {
          throw new Error("Failed to update task");
        }
        return r.json() as Promise<Task>;
      }),
    onMutate: async ({ id, ...input }) => {
      await queryClient.cancelQueries({ queryKey: tasksKey(repo) });
      const previous = queryClient.getQueryData<Task[]>(tasksKey(repo));
      queryClient.setQueryData<Task[]>(tasksKey(repo), (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, ...input } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tasksKey(repo), context.previous);
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repo) }),
  });
}

export function useDeleteTask(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(
        `/api/tasks/${id}?repo=${encodeURIComponent(repo)}`,
        { method: "DELETE" },
      );
      if (!r.ok && r.status !== 404) {
        throw new Error("Failed to delete task");
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: tasksKey(repo) });
      const previous = queryClient.getQueryData<Task[]>(tasksKey(repo));
      queryClient.setQueryData<Task[]>(tasksKey(repo), (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tasksKey(repo), context.previous);
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repo) }),
  });
}

export function useHandoverTask(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/tasks/${id}/handover`, { method: "POST" }).then(async (r) => {
        if (!r.ok) {
          throw new Error("Failed to hand over task");
        }
        return r.json() as Promise<Task>;
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repo) }),
  });
}

export function useRecallTask(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/tasks/${id}/recall`, { method: "POST" }).then(async (r) => {
        if (!r.ok) {
          throw new Error("Failed to recall task");
        }
        return r.json() as Promise<Task>;
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: tasksKey(repo) });
      const previous = queryClient.getQueryData<Task[]>(tasksKey(repo));
      queryClient.setQueryData<Task[]>(tasksKey(repo), (old) =>
        (old ?? []).map((t) =>
          t.id === id
            ? {
                ...t,
                status: "Backlog" as const,
                sessionId: undefined,
              }
            : t,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(tasksKey(repo), context.previous);
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repo) }),
  });
}
