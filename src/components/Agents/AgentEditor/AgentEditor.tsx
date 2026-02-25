// src/components/Agents/AgentEditor/AgentEditor.tsx
"use client";

import { SkillEditor } from "@/components/Skills/SkillEditor";
import type { SkillEditorProps } from "@/components/Skills/SkillEditor";

export type AgentEditorProps = SkillEditorProps;

export function AgentEditor(props: AgentEditorProps) {
  return <SkillEditor {...props} />;
}
