/**
 * captureClaudeSessionId.ts — Locate the Claude JSONL session file created by
 * a `claude -p` handover process so its UUID can be used with `--resume`.
 *
 * Claude Code stores conversation history as JSONL files under:
 *   ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl
 *
 * The path encoding replaces every colon, forward-slash, or back-slash with a
 * hyphen, then strips any leading hyphens.
 *   e.g. "C:/Code/foo"   -> "C--Code-foo"
 *        "/home/user/bar" -> "home-user-bar"
 *
 * After a handover process exits we scan that directory for the newest .jsonl
 * file whose mtime is >= the spawn timestamp.  The file stem (UUID) is the
 * claudeSessionId to pass to `--resume`.
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/**
 * Encode a filesystem path to the directory-name format Claude Code uses.
 * Each colon, forward-slash, or back-slash becomes a hyphen; leading hyphens
 * are stripped.
 */
export function encodeCwdToProjectDir(cwd: string): string {
  return cwd.replace(/[:\\/]/g, "-").replace(/^-+/, "");
}

/**
 * Scan `~/.claude/projects/<encoded-cwd>/` for the JSONL file whose mtime is
 * >= spawnTimestamp.  Among all matching files the newest one wins.
 *
 * Returns the UUID (file stem) on success, or null if nothing is found or
 * the scan fails for any reason.  Failures are logged to stderr.
 */
export async function captureClaudeSessionId(
  cwd: string,
  spawnTimestamp: number,
): Promise<string | null> {
  try {
    const encoded = encodeCwdToProjectDir(cwd);
    const projectDir = join(homedir(), ".claude", "projects", encoded);
    const entries = await readdir(projectDir);
    let bestFile: string | null = null;
    let bestMtime = 0;
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) { continue; }
      const filePath = join(projectDir, name);
      const info = await stat(filePath).catch(() => null);
      if (!info) { continue; }
      const mtime = info.mtimeMs;
      if (mtime >= spawnTimestamp && mtime > bestMtime) {
        bestMtime = mtime;
        bestFile = name;
      }
    }
    if (!bestFile) { return null; }
    return basename(bestFile, ".jsonl");
  } catch (err) {
    process.stderr.write(
      `captureClaudeSessionId: scan failed for ${cwd}: ${String(err)}\n`,
    );
    return null;
  }
}
