import * as pty from "node-pty";

// Strip ANSI/VT escape sequences including OSC sequences.
/* eslint-disable no-control-regex */
const ANSI_RE =
  /\x1b\[[\x20-\x3f]*[\x40-\x7e]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[^[\]]/g;
/* eslint-enable no-control-regex */

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// Module-level map of active PTY processes keyed by task id.
export const activePtys = new Map<string, pty.IPty>();

const BLOCKED_ENV = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_UI_SESSION_ID",
]);

export function buildChildEnv(): Record<string, string> {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!BLOCKED_ENV.has(k) && v !== undefined) {
      childEnv[k] = v;
    }
  }
  return childEnv;
}

export function spawnClaude(args: string[], cwd: string): pty.IPty {
  const claudeCmd =
    process.env["CLAUDE_PATH"] ??
    (process.platform === "win32" ? "claude.cmd" : "claude");

  return pty.spawn(claudeCmd, args, {
    name: "xterm-color",
    cols: 220,
    rows: 24,
    cwd,
    env: buildChildEnv(),
    useConptyDll: process.platform === "win32",
  });
}

export function buildArgs(
  resumeId: string | undefined,
  specText: string,
): string[] {
  const args: string[] = [
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (resumeId) {
    args.push("--resume", resumeId);
  }
  args.push("-p", specText);
  return args;
}
