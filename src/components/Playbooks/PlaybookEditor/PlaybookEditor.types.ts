// src/components/Playbooks/PlaybookEditor/PlaybookEditor.types.ts
export interface PlaybookEditorProps {
  name: string;
  content: string;
  onChange: (content: string) => void;
  onRename: (newName: string) => void;
  onDelete: () => void;
  className?: string;
}
