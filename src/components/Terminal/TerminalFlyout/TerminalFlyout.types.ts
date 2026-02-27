export interface FlyoutSession {
  sessionId: string;
  taskId: string;
  title: string;
  status?: string;
}

export interface TerminalFlyoutProps {
  sessions: FlyoutSession[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onCloseTab: (sessionId: string) => void;
  onClose: () => void;
}
