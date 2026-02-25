export type View = "Board" | "Tasks" | "Archive";

export interface SidebarProps {
  repoId: string;
  currentView: View;
  agentActive: boolean;
}
