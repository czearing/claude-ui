// src/hooks/usePlaybooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPlaybook,
  deletePlaybook,
  fetchPlaybook,
  fetchPlaybooks,
  updatePlaybook,
} from "@/utils/playbooks.client";

const PLAYBOOKS_KEY = ["playbooks"] as const;

function playbookKey(name: string) {
  return ["playbooks", name] as const;
}

export function usePlaybooks() {
  return useQuery({
    queryKey: PLAYBOOKS_KEY,
    queryFn: fetchPlaybooks,
  });
}

export function usePlaybook(name: string | null) {
  return useQuery({
    queryKey: playbookKey(name ?? ""),
    queryFn: () => fetchPlaybook(name!),
    enabled: Boolean(name),
  });
}

export function useCreatePlaybook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      createPlaybook(name, content),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PLAYBOOKS_KEY }),
  });
}

export function useUpdatePlaybook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      updatePlaybook(name, content),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: PLAYBOOKS_KEY });
      queryClient.setQueryData(playbookKey(data.name), data);
    },
  });
}

export function useDeletePlaybook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deletePlaybook(name),
    onSuccess: (_data, name) => {
      void queryClient.invalidateQueries({ queryKey: PLAYBOOKS_KEY });
      void queryClient.removeQueries({ queryKey: playbookKey(name) });
    },
  });
}
