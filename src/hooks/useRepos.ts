// src/hooks/useRepos.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/utils/apiFetch";

export interface Repo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface CreateRepoInput {
  name: string;
  path: string;
}

const REPOS_KEY = ["repos"] as const;

async function fetchRepos(): Promise<Repo[]> {
  return apiFetch<Repo[]>("/api/repos");
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
      apiFetch<Repo>("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REPOS_KEY }),
  });
}

export function useDeleteRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/repos/${id}`, { method: "DELETE", allow404: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REPOS_KEY }),
  });
}
