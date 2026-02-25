// src/components/Skills/SkillEditor/SkillEditor.types.ts
export interface SkillEditorProps {
  name: string;
  description: string;
  content: string;
  onChange: (description: string, content: string) => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  className?: string;
}
