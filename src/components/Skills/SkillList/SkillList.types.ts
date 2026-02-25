// src/components/Skills/SkillList/SkillList.types.ts
import type { SkillScope } from "@/utils/skills.client";

export type { SkillScope };

export interface SkillListProps {
  skills: { name: string; description: string }[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
  scope: SkillScope;
  onScopeChange: (scope: SkillScope) => void;
  title?: string;
  className?: string;
}
