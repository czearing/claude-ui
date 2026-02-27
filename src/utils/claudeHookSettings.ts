import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";

function hookDir(sessionId: string): string {
  return join(tmpdir(), `claude-hooks-${sessionId}`);
}

/**
 * The notify.mjs helper is invoked by Claude Code's Stop hook.
 * It makes a fire-and-forget POST to advance the task to Review status.
 */
const notifyScript = `// Called by Claude Code Stop hook to notify server that Claude finished its turn
const [,, port, sessionId] = process.argv;
fetch(\`http://localhost:\${port}/api/internal/sessions/\${sessionId}/advance-to-review\`, { method: "POST" })
  .catch(() => {});
`;

/**
 * Creates a temporary directory containing a settings.json with a Stop hook
 * and a notify.mjs helper script. Returns the absolute path to settings.json.
 */
export function createHookSettingsFile(
  sessionId: string,
  serverPort: string,
): string {
  const dir = hookDir(sessionId);
  mkdirSync(dir, { recursive: true });

  const notifyScriptPath = join(dir, "notify.mjs");
  writeFileSync(notifyScriptPath, notifyScript, "utf-8");

  // Use forward slashes so paths are unambiguous across platforms and safe
  // inside JSON strings. JSON.stringify handles any remaining escaping.
  const node = execPath.replaceAll("\\", "/");
  const script = notifyScriptPath.replaceAll("\\", "/");
  const command = `"${node}" "${script}" "${serverPort}" "${sessionId}"`;

  const settings = {
    hooks: {
      Stop: [
        {
          matcher: "",
          hooks: [{ type: "command", command }],
        },
      ],
    },
  };

  const settingsPath = join(dir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");

  return settingsPath;
}

/**
 * Removes the temporary hook directory for the given session.
 * Errors are swallowed -- this is non-fatal cleanup.
 */
export function cleanupHookSettingsDir(sessionId: string): void {
  try {
    rmSync(hookDir(sessionId), { recursive: true, force: true });
  } catch {
    // non-fatal -- ignore
  }
}
