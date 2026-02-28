export type ClaudeStatus =
  | "connecting"
  | "thinking"
  | "typing"
  | "waiting"
  | "done"
  | "idle"
  | "exited"
  | "disconnected";

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  options?: { label: string; description?: string }[];
}
