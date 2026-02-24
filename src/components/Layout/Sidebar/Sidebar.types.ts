export type View = 'Board' | 'Backlog';

export interface SidebarProps {
  currentView: View;
  agentActive: boolean;
  onViewChange: (view: View) => void;
}
