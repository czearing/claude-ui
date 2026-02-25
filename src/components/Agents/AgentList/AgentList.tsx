// src/components/Agents/AgentList/AgentList.tsx
"use client";

import { SkillList } from "@/components/Skills/SkillList";
import type { SkillScope } from "@/components/Skills/SkillList";

export type AgentScope = SkillScope;

export interface AgentListProps {
  agents: { name: string; description: string }[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
  scope: AgentScope;
  onScopeChange: (scope: AgentScope) => void;
  className?: string;
}

export function AgentList({
  agents,
  selectedName,
  onSelect,
  onNew,
  scope,
  onScopeChange,
  className,
}: AgentListProps) {
  return (
    <SkillList
      skills={agents}
      selectedName={selectedName}
      onSelect={onSelect}
      onNew={onNew}
      scope={scope}
      onScopeChange={onScopeChange}
      title="Agents"
      className={className}
    />
  );
}
