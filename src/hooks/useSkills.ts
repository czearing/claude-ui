// src/hooks/useSkills.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SkillScope } from "@/utils/skills.client";
import {
  createSkill,
  deleteSkill,
  fetchSkill,
  fetchSkills,
  updateSkill,
} from "@/utils/skills.client";

function skillsKey(scope: SkillScope, repoId?: string) {
  return ["skills", scope, repoId ?? ""] as const;
}

function skillKey(scope: SkillScope, repoId: string | undefined, name: string) {
  return ["skills", scope, repoId ?? "", name] as const;
}

export function useSkills(scope: SkillScope = "global", repoId?: string) {
  return useQuery({
    queryKey: skillsKey(scope, repoId),
    queryFn: () => fetchSkills(scope, repoId),
  });
}

export function useSkill(
  name: string | null,
  scope: SkillScope = "global",
  repoId?: string,
) {
  return useQuery({
    queryKey: skillKey(scope, repoId, name ?? ""),
    queryFn: () => fetchSkill(name!, scope, repoId),
    enabled: Boolean(name),
  });
}

export function useCreateSkill(scope: SkillScope = "global", repoId?: string) {
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
    }) => createSkill(name, description, content, scope, repoId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: skillsKey(scope, repoId) }),
  });
}

export function useUpdateSkill(scope: SkillScope = "global", repoId?: string) {
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
    }) => updateSkill(name, description, content, scope, repoId),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: skillsKey(scope, repoId),
      });
      queryClient.setQueryData(skillKey(scope, repoId, data.name), data);
    },
  });
}

export function useDeleteSkill(scope: SkillScope = "global", repoId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => deleteSkill(name, scope, repoId),
    onSuccess: (_data, name) => {
      void queryClient.invalidateQueries({
        queryKey: skillsKey(scope, repoId),
      });
      void queryClient.removeQueries({
        queryKey: skillKey(scope, repoId, name),
      });
    },
  });
}
