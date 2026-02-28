import type { ClaudeStatus, Message } from "./useChatStream.types";
import {
  extractMessagesFromEvent,
  extractToolResultText,
} from "../utils/streamMessageExtractor";

export { extractToolResultText };

export async function readNdjsonStream(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    let done: boolean;
    let value: Uint8Array | undefined;
    try {
      ({ done, value } = await reader.read());
    } catch {
      break;
    }
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue;
      }
      onEvent(event);
    }
  }
}

export type StreamAction =
  | { op: "status"; status: ClaudeStatus }
  | { op: "addMessages"; messages: Message[] }
  | { op: "sessionId"; id: string };

export function parseStreamEvent(
  event: Record<string, unknown>,
): StreamAction[] {
  const type = event.type as string;
  const subtype = event.subtype as string | undefined;

  if (type === "system" && subtype === "init") {
    const sid = event.session_id as string | undefined;
    const actions: StreamAction[] = [{ op: "status", status: "thinking" }];
    if (sid) {
      actions.unshift({ op: "sessionId", id: sid });
    }
    return actions;
  }

  if (type === "assistant") {
    const extracted = extractMessagesFromEvent(event);
    const messages: Message[] = extracted.map((m) => ({
      id: crypto.randomUUID(),
      role: m.role,
      content: m.content,
      toolName: m.toolName,
    }));
    const actions: StreamAction[] = [{ op: "status", status: "typing" }];
    if (messages.length > 0) {
      actions.push({ op: "addMessages", messages });
    }
    return actions;
  }

  if (type === "user") {
    const extracted = extractMessagesFromEvent(event);
    const messages: Message[] = extracted.map((m) => ({
      id: crypto.randomUUID(),
      role: m.role,
      content: m.content,
      toolName: m.toolName,
    }));
    const actions: StreamAction[] = [{ op: "status", status: "thinking" }];
    if (messages.length > 0) {
      actions.unshift({ op: "addMessages", messages });
    }
    return actions;
  }

  if (type === "result") {
    return [{ op: "status", status: "done" }];
  }

  if (type === "done") {
    return [{ op: "status", status: "idle" }];
  }

  return [];
}
