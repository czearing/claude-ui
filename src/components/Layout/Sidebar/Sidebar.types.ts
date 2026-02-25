// src/components/Layout/Sidebar/Sidebar.types.ts
export type View = "Board" | "Tasks" | "Playbooks" | "Archive" | "Settings";

export interface SidebarProps {
  repoId?: string;
  currentView: View;
  agentActive?: boolean;
}
