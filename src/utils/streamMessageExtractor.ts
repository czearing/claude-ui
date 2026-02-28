// Shared stream message extraction — no browser APIs, safe for server and client.

interface ExtractedMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  options?: { label: string; description?: string }[];
}

const TOOL_RESULT_MAX_CHARS = 4096;

export function extractToolResultText(
  content: string | { type: string; text: string }[],
): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

export function extractMessagesFromEvent(
  event: Record<string, unknown>,
): ExtractedMessage[] {
  const type = event.type as string;

  if (type === "assistant") {
    const msg = event.message as
      | {
          content?: {
            type: string;
            text?: string;
            name?: string;
            id?: string;
            input?: unknown;
          }[];
        }
      | undefined;
    const messages: ExtractedMessage[] = [];
    for (const block of msg?.content ?? []) {
      if (block.type === "text" && block.text) {
        messages.push({ role: "assistant", content: block.text });
      } else if (block.type === "tool_use") {
        if (block.name === "AskUserQuestion") {
          // Real AskUserQuestion format:
          // { questions: [{ question, header, multiSelect, options: [{ label, description }] }] }
          const input = block.input as
            | {
                questions?: {
                  question?: string;
                  options?: { label: string; description?: string }[];
                }[];
              }
            | undefined;
          const q = input?.questions?.[0];
          messages.push({
            role: "assistant",
            content: q?.question ?? "",
            options: q?.options,
          });
        } else {
          messages.push({
            role: "tool",
            content: "",
            toolName: block.name ?? "tool",
          });
        }
      }
    }
    return messages;
  }

  if (type === "user") {
    const msg = event.message as
      | {
          content?: {
            type: string;
            tool_use_id?: string;
            content?: unknown;
            text?: string;
          }[];
        }
      | undefined;
    const messages: ExtractedMessage[] = [];
    for (const block of msg?.content ?? []) {
      if (block.type === "tool_result") {
        const raw = block.content as
          | string
          | { type: string; text: string }[]
          | undefined;
        let text = raw != null ? extractToolResultText(raw) : "";
        if (text.length > TOOL_RESULT_MAX_CHARS) {
          text = `${text.slice(0, TOOL_RESULT_MAX_CHARS)}…[truncated]`;
        }
        messages.push({ role: "system", content: text });
      } else if (block.type === "text" && block.text) {
        messages.push({ role: "user", content: block.text });
      }
    }
    return messages;
  }

  return [];
}
