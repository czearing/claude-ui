import type { Session } from "../../hooks/useSessionStore";

export type { Session };

export type InstanceCardProps = {
  session: Session;
  onOpen: (session: Session) => void;
  onDelete: (id: string) => void;
};
