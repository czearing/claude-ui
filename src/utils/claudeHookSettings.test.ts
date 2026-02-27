/**
 * @jest-environment node
 */
import {
  createHookSettingsFile,
  cleanupHookSettingsDir,
} from "./claudeHookSettings";

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SESSION_ID = "test-session-abc123";
const SERVER_PORT = "3001";

describe("createHookSettingsFile", () => {
  afterEach(() => {
    cleanupHookSettingsDir(SESSION_ID);
  });

  it("returns a path ending in settings.json", () => {
    const settingsPath = createHookSettingsFile(SESSION_ID, SERVER_PORT);

    expect(settingsPath.endsWith("settings.json")).toBe(true);
  });

  it("the returned path exists on disk", () => {
    const settingsPath = createHookSettingsFile(SESSION_ID, SERVER_PORT);

    expect(existsSync(settingsPath)).toBe(true);
  });

  it("the file contains valid JSON", async () => {
    const settingsPath = createHookSettingsFile(SESSION_ID, SERVER_PORT);
    const raw = await readFile(settingsPath, "utf-8");

    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("the JSON has a Stop hook array at hooks.Stop", async () => {
    const settingsPath = createHookSettingsFile(SESSION_ID, SERVER_PORT);
    const raw = await readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: {
        Stop: { matcher: string; hooks: { type: string; command: string }[] }[];
      };
    };

    expect(Array.isArray(parsed.hooks.Stop)).toBe(true);
    expect(parsed.hooks.Stop.length).toBeGreaterThan(0);
  });

  it("the Stop hook entry has a command hook type", async () => {
    const settingsPath = createHookSettingsFile(SESSION_ID, SERVER_PORT);
    const raw = await readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: {
        Stop: { matcher: string; hooks: { type: string; command: string }[] }[];
      };
    };

    const hookEntry = parsed.hooks.Stop[0];
    expect(hookEntry).toBeDefined();
    expect(hookEntry.hooks[0].type).toBe("command");
  });

  it("the command contains the session ID", async () => {
    const settingsPath = createHookSettingsFile(SESSION_ID, SERVER_PORT);
    const raw = await readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: {
        Stop: { matcher: string; hooks: { type: string; command: string }[] }[];
      };
    };

    const command = parsed.hooks.Stop[0].hooks[0].command;
    expect(command).toContain(SESSION_ID);
  });

  it("the command contains the server port", async () => {
    const settingsPath = createHookSettingsFile(SESSION_ID, SERVER_PORT);
    const raw = await readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: {
        Stop: { matcher: string; hooks: { type: string; command: string }[] }[];
      };
    };

    const command = parsed.hooks.Stop[0].hooks[0].command;
    expect(command).toContain(SERVER_PORT);
  });

  it("the command uses forward slashes in paths so JSON.stringify does not double-escape Windows backslashes", async () => {
    const settingsPath = createHookSettingsFile(SESSION_ID, SERVER_PORT);
    const raw = await readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      hooks: {
        Stop: { matcher: string; hooks: { type: string; command: string }[] }[];
      };
    };

    const command = parsed.hooks.Stop[0].hooks[0].command;
    // Backslashes in Windows paths cause double-escaping when esc() is applied
    // before JSON.stringify. The command must use forward slashes to be safe on
    // all platforms (Node.js accepts forward slashes on Windows).
    expect(command).not.toMatch(/\\\\/);
  });

  it("also writes the notify.mjs helper script", () => {
    createHookSettingsFile(SESSION_ID, SERVER_PORT);
    const notifyPath = join(
      tmpdir(),
      `claude-hooks-${SESSION_ID}`,
      "notify.mjs",
    );

    expect(existsSync(notifyPath)).toBe(true);
  });
});

describe("cleanupHookSettingsDir", () => {
  it("removes the directory created by createHookSettingsFile", () => {
    const settingsPath = createHookSettingsFile(SESSION_ID, SERVER_PORT);
    expect(existsSync(settingsPath)).toBe(true);

    cleanupHookSettingsDir(SESSION_ID);

    const dir = join(tmpdir(), `claude-hooks-${SESSION_ID}`);
    expect(existsSync(dir)).toBe(false);
  });

  it("does not throw when the directory does not exist", () => {
    expect(() =>
      cleanupHookSettingsDir("nonexistent-session-xyz"),
    ).not.toThrow();
  });
});
