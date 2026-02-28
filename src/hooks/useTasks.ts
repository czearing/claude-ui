// src/hooks/useTasks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/utils/apiFetch";
import type {
  CreateTaskInput,
  Task,
  UpdateTaskInput,
} from "@/utils/tasks.types";

export function tasksKey(repo: string) {
  return ["tasks", repo] as const;
}

async function fetchTasks(repo: string): Promise<Task[]> {
  return apiFetch<Task[]>(`/api/tasks?repo=${encodeURIComponent(repo)}`);
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
      apiFetch<Task>("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, repo }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repo) }),
  });
}

export function useUpdateTask(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) =>
      apiFetch<Task>(`/api/tasks/${id}?repo=${encodeURIComponent(repo)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
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
    mutationFn: (id: string) =>
      apiFetch(`/api/tasks/${id}?repo=${encodeURIComponent(repo)}`, {
        method: "DELETE",
        allow404: true,
      }),
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

export function useRecallTask(repo: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Task>(`/api/tasks/${id}/recall`, { method: "POST" }),
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
