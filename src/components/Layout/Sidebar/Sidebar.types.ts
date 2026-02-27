// src/components/Layout/Sidebar/Sidebar.types.ts
export type View =
  | "Board"
  | "Tasks"
  | "Skills"
  | "Agents"
  | "Archive"
  | "Settings";

export interface SidebarProps {
  repo?: string;
  currentView: View;
}
