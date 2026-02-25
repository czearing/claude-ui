import type { View } from "../Sidebar/Sidebar.types";

export interface TopBarProps {
  currentView: View;
  onNewIssue: () => void;
}
