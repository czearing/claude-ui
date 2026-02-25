// src/hooks/useTasks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateTaskInput,
  Task,
  UpdateTaskInput,
} from "@/utils/tasks.types";

function tasksKey(repoId: string) {
  return ["tasks", repoId] as const;
}

async function fetchTasks(repoId: string): Promise<Task[]> {
  const res = await fetch(`/api/tasks?repoId=${encodeURIComponent(repoId)}`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json() as Promise<Task[]>;
}

export function useTasks(repoId: string) {
  return useQuery({
    queryKey: tasksKey(repoId),
    queryFn: () => fetchTasks(repoId),
    enabled: !!repoId,
  });
}

export function useCreateTask(repoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateTaskInput, "repoId">) =>
      fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, repoId }),
      }).then((r) => r.json()) as Promise<Task>,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repoId) }),
  });
}

export function useUpdateTask(repoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTaskInput & { id: string }) =>
      fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).then((r) => r.json()) as Promise<Task>,
    onMutate: async ({ id, ...input }) => {
      await queryClient.cancelQueries({ queryKey: tasksKey(repoId) });
      const previous = queryClient.getQueryData<Task[]>(tasksKey(repoId));
      queryClient.setQueryData<Task[]>(tasksKey(repoId), (old) =>
        (old ?? []).map((t) =>
          t.id === id
            ? { ...t, ...input, updatedAt: new Date().toISOString() }
            : t,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(tasksKey(repoId), context.previous);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repoId) }),
  });
}

export function useDeleteTask(repoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetch(`/api/tasks/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: tasksKey(repoId) });
      const previous = queryClient.getQueryData<Task[]>(tasksKey(repoId));
      queryClient.setQueryData<Task[]>(tasksKey(repoId), (old) =>
        (old ?? []).filter((t) => t.id !== id),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(tasksKey(repoId), context.previous);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repoId) }),
  });
}

export function useHandoverTask(repoId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/tasks/${id}/handover`, { method: "POST" }).then((r) =>
        r.json(),
      ) as Promise<Task>,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: tasksKey(repoId) }),
  });
}
