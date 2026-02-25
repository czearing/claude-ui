export type View = "Board" | "Backlog";

export interface SidebarProps {
  repoId: string;
  currentView: View;
  agentActive: boolean;
  onViewChange: (view: View) => void;
}
