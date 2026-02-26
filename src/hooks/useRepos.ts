// src/hooks/useRepos.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CreateRepoInput, Repo } from "@/utils/tasks.types";

const REPOS_KEY = ["repos"] as const;

async function fetchRepos(): Promise<Repo[]> {
  const res = await fetch("/api/repos");
  if (!res.ok) {
    throw new Error("Failed to fetch repos");
  }
  return res.json() as Promise<Repo[]>;
}

export function useRepos() {
  return useQuery({
    queryKey: REPOS_KEY,
    queryFn: fetchRepos,
    staleTime: Infinity, // WebSocket keeps repos fresh via invalidation
  });
}

export function useCreateRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRepoInput) =>
      fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).then(async (r) => {
        if (!r.ok) {
          const err = (await r.json()) as { error: string };
          throw new Error(err.error);
        }
        return r.json() as Promise<Repo>;
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REPOS_KEY }),
  });
}

export function useDeleteRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/repos/${id}`, { method: "DELETE" });
      if (!r.ok && r.status !== 404) {
        throw new Error("Failed to delete repo");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REPOS_KEY }),
  });
}
