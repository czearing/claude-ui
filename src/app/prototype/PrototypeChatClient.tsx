"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant" | "tool" | "system";
type Message = {
  id: string;
  role: Role;
  content: string;
  toolName?: string;
  isError?: boolean;
};
type Repo = { id: string; name: string; path: string };
type ClaudeStatus =
  | "idle"
  | "connecting"
  | "thinking"
  | "typing"
  | "done"
  | "error";

const STATUS_LABEL: Record<ClaudeStatus, string> = {
  idle: "Ready",
  connecting: "Connecting...",
  thinking: "Thinking...",
  typing: "Typing...",
  done: "Done",
  error: "Error",
};
const STATUS_COLOR: Record<ClaudeStatus, string> = {
  idle: "#555",
  connecting: "#a0a0a5",
  thinking: "#f59e0b",
  typing: "#7c3aed",
  done: "#22c55e",
  error: "#f85149",
};
const PULSE = "thinking connecting typing";

const S = {
  page: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    background: "#0a0a0a",
    color: "#ededef",
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 16px",
    borderBottom: "1px solid #2e2e32",
    background: "#111113",
    flexShrink: 0,
  },
  title: { fontSize: 14, fontWeight: 600, color: "#ededef" },
  badge: (s: ClaudeStatus) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 10px",
    borderRadius: 20,
    background: "#1e1e21",
    border: `1px solid ${STATUS_COLOR[s]}`,
    fontSize: 12,
    color: STATUS_COLOR[s],
    fontWeight: 500,
  }),
  dot: (s: ClaudeStatus) => ({
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: STATUS_COLOR[s],
    animation: PULSE.includes(s) ? "pulse 1.2s ease-in-out infinite" : "none",
    flexShrink: 0,
  }),
  spacer: { flex: 1 },
  select: {
    background: "#1e1e21",
    color: "#ededef",
    border: "1px solid #2e2e32",
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 12,
    cursor: "pointer",
    maxWidth: 160,
  },
  // session banner shown below header when session is active
  sessionBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 16px",
    background: "#0f0f12",
    borderBottom: "1px solid #2e2e32",
    fontSize: 11,
  },
  sessionBannerLabel: { color: "#7c3aed", fontWeight: 600 },
  sessionBannerId: {
    color: "#a0a0a5",
    fontFamily: "var(--font-mono, monospace)",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  smallBtn: {
    background: "transparent",
    color: "#a0a0a5",
    border: "1px solid #2e2e32",
    borderRadius: 5,
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
    flexShrink: 0,
  },
  // empty state shown in the messages area
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    color: "#555",
    fontSize: 13,
    padding: 40,
  },
  emptyResume: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 8,
    padding: "16px 24px",
    background: "#111113",
    borderRadius: 10,
    border: "1px solid #2e2e32",
    textAlign: "center" as const,
    maxWidth: 360,
  },
  resumeId: {
    color: "#7c3aed",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    wordBreak: "break-all" as const,
  },
  resumeHint: { color: "#a0a0a5", fontSize: 12, lineHeight: 1.5 },
  // resume input shown in empty state
  resumeInput: {
    background: "#1e1e21",
    color: "#ededef",
    border: "1px solid #2e2e32",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "var(--font-mono, monospace)",
    width: "100%",
    outline: "none",
  },
  resumeBtn: {
    background: "#7c3aed",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  },
  messages: { flex: 1, overflowY: "auto" as const, padding: "14px 0" },
  row: (role: Role) => ({
    display: "flex",
    justifyContent: role === "user" ? "flex-end" : "flex-start",
    padding: "3px 16px",
  }),
  userBubble: {
    background: "#1d4ed8",
    color: "#fff",
    borderRadius: "18px 18px 4px 18px",
    padding: "9px 14px",
    maxWidth: "72%",
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  assistantBubble: {
    background: "#1e1e21",
    color: "#ededef",
    borderRadius: "18px 18px 18px 4px",
    padding: "9px 14px",
    maxWidth: "75%",
    fontSize: 14,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    border: "1px solid #2e2e32",
  },
  toolCard: {
    background: "#161618",
    border: "1px solid #2e2e32",
    borderRadius: 8,
    padding: "8px 12px",
    maxWidth: "80%",
    fontSize: 12,
  },
  toolLabel: {
    color: "#7c3aed",
    fontWeight: 600,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 4,
  },
  toolCode: {
    background: "#0a0a0a",
    borderRadius: 4,
    padding: "6px 10px",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11,
    color: "#ededef",
    whiteSpace: "pre-wrap" as const,
    maxHeight: 180,
    overflowY: "auto" as const,
    marginTop: 4,
  },
  toolResult: {
    background: "#111113",
    border: "1px solid #1e1e21",
    borderRadius: 8,
    padding: "5px 10px",
    maxWidth: "80%",
    fontSize: 11,
    color: "#a0a0a5",
    fontFamily: "var(--font-mono, monospace)",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
  },
  errBubble: {
    background: "rgba(248,81,73,0.1)",
    border: "1px solid rgba(248,81,73,0.3)",
    borderRadius: "18px 18px 18px 4px",
    padding: "9px 14px",
    maxWidth: "75%",
    fontSize: 13,
    color: "#f85149",
  },
  blink: (delay: number) => ({
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#a0a0a5",
    margin: "0 2px",
    animation: "pulse 1.2s ease-in-out infinite",
    animationDelay: `${delay}s`,
  }),
  footer: {
    borderTop: "1px solid #2e2e32",
    padding: "10px 16px",
    background: "#111113",
    display: "flex",
    gap: 8,
    flexShrink: 0,
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    background: "#1e1e21",
    color: "#ededef",
    border: "1px solid #2e2e32",
    borderRadius: 10,
    padding: "9px 12px",
    fontSize: 14,
    resize: "none" as const,
    outline: "none",
    lineHeight: 1.5,
    minHeight: 42,
    maxHeight: 140,
    fontFamily: "inherit",
  },
  sendBtn: (disabled: boolean) => ({
    background: disabled ? "#2e2e32" : "#1d4ed8",
    color: disabled ? "#555" : "#fff",
    border: "none",
    borderRadius: 10,
    padding: "9px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    height: 42,
    flexShrink: 0,
  }),
};

function Dots() {
  return (
    <div style={{ ...S.assistantBubble, padding: "11px 16px" }}>
      <span style={S.blink(0)} />
      <span style={S.blink(0.2)} />
      <span style={S.blink(0.4)} />
    </div>
  );
}

export function PrototypeChatClient() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [resumeInput, setResumeInput] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ClaudeStatus>("idle");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedCwd, setSelectedCwd] = useState("");
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/repos")
      .then((r) => r.json())
      .then((data: Repo[]) => {
        setRepos(data);
        if (data.length > 0) {
          setSelectedCwd(data[0].path);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  function addMsg(msg: Omit<Message, "id">) {
    setMessages((prev) => [...prev, { ...msg, id: crypto.randomUUID() }]);
  }

  function copySessionId() {
    void navigator.clipboard.writeText(sessionId).then(() => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 1500);
    });
  }

  async function loadHistory(id: string, cwd: string) {
    try {
      const resp = await fetch(
        `/api/prototype/history?sessionId=${encodeURIComponent(id)}&cwd=${encodeURIComponent(cwd)}`,
      );
      if (!resp.ok) {
        return;
      }
      const msgs = (await resp.json()) as Array<{
        role: "user" | "assistant" | "tool";
        content: string;
        toolName?: string;
      }>;
      setMessages(msgs.map((m) => ({ ...m, id: crypto.randomUUID() })));
    } catch {
      // non-fatal — history just won't be shown
    }
  }

  function startResume() {
    const id = resumeInput.trim();
    if (!id) {
      return;
    }
    setSessionId(id);
    setResumeInput("");
    setMessages([]);
    setStatus("idle");
    void loadHistory(id, selectedCwd);
  }

  function newSession() {
    setSessionId("");
    setMessages([]);
    setStatus("idle");
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || status !== "idle") {
      return;
    }
    setInput("");
    addMsg({ role: "user", content: text });
    setStatus("connecting");

    try {
      const res = await fetch("/api/prototype/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          cwd: selectedCwd,
          sessionId: sessionId || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        addMsg({
          role: "system",
          content: `HTTP ${res.status}`,
          isError: true,
        });
        setStatus("error");
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const t = line.trim();
          if (!t) {
            continue;
          }
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(t);
          } catch {
            continue;
          }

          if (ev.type === "system" && ev.subtype === "init") {
            setSessionId(ev.session_id as string);
            setStatus("thinking");
          } else if (ev.type === "assistant") {
            setStatus("typing");
            const msg = ev.message as {
              content: Array<{
                type: string;
                text?: string;
                name?: string;
                input?: unknown;
              }>;
            };
            for (const item of msg.content ?? []) {
              if (item.type === "text" && item.text) {
                addMsg({ role: "assistant", content: item.text });
              } else if (item.type === "tool_use") {
                addMsg({
                  role: "tool",
                  content: JSON.stringify(item.input, null, 2),
                  toolName: item.name,
                });
              }
            }
          } else if (ev.type === "user") {
            const msg = ev.message as {
              content: Array<{ type: string; content?: unknown }>;
            };
            for (const item of msg.content ?? []) {
              if (item.type === "tool_result") {
                // content is either a plain string or an array of {type,text} objects
                let txt = "";
                if (typeof item.content === "string") {
                  txt = item.content;
                } else if (Array.isArray(item.content)) {
                  txt = (item.content as Array<{ text?: string }>)
                    .map((c) => c.text ?? "")
                    .join("");
                }
                if (txt) {
                  addMsg({ role: "system", content: txt });
                }
                setStatus("thinking");
              }
            }
          } else if (ev.type === "result") {
            // Capture session_id from result as a reliable source.
            if (typeof ev.session_id === "string" && ev.session_id) {
              setSessionId(ev.session_id);
            }
            if (ev.subtype === "error") {
              const errVal = ev["error"];
              addMsg({
                role: "system",
                content: typeof errVal === "string" ? errVal : "Unknown error",
                isError: true,
              });
              setStatus("error");
            } else {
              setStatus("done");
            }
          } else if (ev.type === "done") {
            setStatus((s) => (s === "error" ? s : "idle"));
          }
        }
      }
    } catch (err) {
      addMsg({ role: "system", content: String(err), isError: true });
      setStatus("error");
    } finally {
      setStatus((s) =>
        ["connecting", "thinking", "typing"].includes(s) ? "idle" : s,
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void sendMessage();
    }
  }

  const isStreaming = !["idle", "done", "error"].includes(status);
  const shortId = sessionId ? `${sessionId.slice(0, 8)}...` : "";
  const inputPlaceholder = sessionId
    ? `Continue session ${shortId} (Ctrl+Enter to send)`
    : "Start a new conversation... (Ctrl+Enter to send)";

  function renderMessage(msg: Message) {
    if (msg.role === "user") {
      return (
        <div key={msg.id} style={S.row("user")}>
          <div style={S.userBubble}>{msg.content}</div>
        </div>
      );
    }
    if (msg.role === "tool") {
      return (
        <div key={msg.id} style={S.row("assistant")}>
          <div style={S.toolCard}>
            <div style={S.toolLabel}>{msg.toolName}</div>
            <div style={S.toolCode}>{msg.content}</div>
          </div>
        </div>
      );
    }
    if (msg.role === "system") {
      return (
        <div key={msg.id} style={S.row("assistant")}>
          {msg.isError ? (
            <div style={S.errBubble}>{msg.content}</div>
          ) : (
            <div style={S.toolResult}>{msg.content}</div>
          )}
        </div>
      );
    }
    return (
      <div key={msg.id} style={S.row("assistant")}>
        <div style={S.assistantBubble}>{msg.content}</div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <header style={S.header}>
        <span style={S.title}>Prototype Chat</span>
        <div style={S.badge(status)}>
          <span style={S.dot(status)} />
          {STATUS_LABEL[status]}
        </div>
        <div style={S.spacer} />
        <select
          style={S.select}
          value={selectedCwd}
          onChange={(e) => setSelectedCwd(e.target.value)}
          aria-label="Repository"
        >
          {repos.length === 0 && <option value="">Loading...</option>}
          {repos.map((r) => (
            <option key={r.id} value={r.path}>
              {r.name}
            </option>
          ))}
        </select>
      </header>

      {/* Session banner — only shown when a session is active */}
      {sessionId && (
        <div style={S.sessionBanner}>
          <span style={S.sessionBannerLabel}>Session</span>
          <span style={S.sessionBannerId} title={sessionId}>
            {sessionId}
          </span>
          <button
            style={S.smallBtn}
            onClick={copySessionId}
            aria-label="Copy session ID"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            style={S.smallBtn}
            onClick={newSession}
            aria-label="New session"
          >
            New session
          </button>
        </div>
      )}

      {/* Messages or empty state */}
      {messages.length === 0 && !isStreaming ? (
        <div style={S.emptyState}>
          {sessionId ? (
            <div style={S.emptyResume}>
              <div style={S.sessionBannerLabel}>Resuming session</div>
              <div style={S.resumeId}>{sessionId}</div>
              <div style={S.resumeHint}>
                Type a follow-up message below and hit Send. Claude will pick up
                the conversation where it left off.
              </div>
            </div>
          ) : (
            <>
              <div>Start a new conversation, or resume a previous session.</div>
              <div style={S.emptyResume}>
                <div
                  style={{ color: "#a0a0a5", fontWeight: 600, fontSize: 12 }}
                >
                  Resume a session
                </div>
                <input
                  style={S.resumeInput}
                  value={resumeInput}
                  onChange={(e) => setResumeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      startResume();
                    }
                  }}
                  placeholder="Paste session ID here..."
                  spellCheck={false}
                  aria-label="Session ID to resume"
                />
                <button
                  style={S.resumeBtn}
                  onClick={startResume}
                  disabled={!resumeInput.trim()}
                >
                  Resume session
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={S.messages} role="log" aria-live="polite">
          {messages.map(renderMessage)}
          {isStreaming && (
            <div style={S.row("assistant")}>
              <Dots />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Footer */}
      <footer style={S.footer}>
        <textarea
          style={S.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={inputPlaceholder}
          rows={1}
          disabled={isStreaming}
          aria-label="Message input"
        />
        <button
          style={S.sendBtn(isStreaming || !input.trim())}
          onClick={() => {
            void sendMessage();
          }}
          disabled={isStreaming || !input.trim()}
        >
          Send
        </button>
      </footer>
    </div>
  );
}
