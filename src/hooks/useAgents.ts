// src/hooks/useAgents.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AgentScope } from "@/utils/agents.client";
import {
  createAgent,
  deleteAgent,
  fetchAgent,
  fetchAgents,
  updateAgent,
} from "@/utils/agents.client";

function agentsKey(scope: AgentScope, repoId?: string) {
  return ["agents", scope, repoId ?? ""] as const;
}

function agentKey(scope: AgentScope, repoId: string | undefined, name: string) {
  return ["agents", scope, repoId ?? "", name] as const;
}

export function useAgents(scope: AgentScope = "global", repoId?: string) {
  return useQuery({
    queryKey: agentsKey(scope, repoId),
    queryFn: () => fetchAgents(scope, repoId),
  });
}

export function useAgent(
  name: string | null,
  scope: AgentScope = "global",
  repoId?: string,
) {
  return useQuery({
    queryKey: agentKey(scope, repoId, name ?? ""),
    queryFn: () => fetchAgent(name!, scope, repoId),
    enabled: Boolean(name),
  });
}

export function useCreateAgent(scope: AgentScope = "global", repoId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      description,
      content,
    }: {
      name: string;
      description: string;
      content: string;
    }) => createAgent(name, description, content, scope, repoId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentsKey(scope, repoId) }),
  });
}

export function useUpdateAgent(scope: AgentScope = "global", repoId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      description,
      content,
    }: {
      name: string;
      description: string;
      content: string;
    }) => updateAgent(name, description, content, scope, repoId),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: agentsKey(scope, repoId),
      });
      queryClient.setQueryData(agentKey(scope, repoId, data.name), data);
    },
  });
}

export function useDeleteAgent(scope: AgentScope = "global", repoId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteAgent(name, scope, repoId),
    onSuccess: (_data, name) => {
      void queryClient.invalidateQueries({
        queryKey: agentsKey(scope, repoId),
      });
      void queryClient.removeQueries({
        queryKey: agentKey(scope, repoId, name),
      });
    },
  });
}
