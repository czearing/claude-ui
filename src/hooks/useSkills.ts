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
      // Use exact:true so only the skills LIST is invalidated. Without it,
      // TanStack Query's default prefix matching would also mark the individual
      // skill query as stale and trigger a background refetch. That refetch
      // returns content trimmed by parseFrontmatterDoc, which differs from the
      // un-trimmed PUT response — breaking the val===content guard in
      // SkillEditor and causing an infinite save loop that makes the editor
      // appear to refresh every few seconds while typing.
      void queryClient.invalidateQueries({
        queryKey: skillsKey(scope, repoId),
        exact: true,
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
