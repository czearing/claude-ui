// src/components/Playbooks/PlaybookList/PlaybookList.types.ts
export interface PlaybookListProps {
  playbooks: { name: string }[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
  className?: string;
}
