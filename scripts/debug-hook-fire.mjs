#!/usr/bin/env node
/**
 * debug-hook-fire.mjs
 *
 * Verifies whether Claude Code's Stop hook fires when spawned with
 * --settings pointing to a settings.json that defines a Stop hook.
 *
 * The hook writes a marker file. We check for that file after Claude exits.
 */
import * as pty from "node-pty";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execPath } from "process";

const { CLAUDECODE: _cc, ...ENV } = process.env;
const sessionId = `hook-test-${Date.now()}`;
const dir = join(tmpdir(), `claude-hooks-${sessionId}`);
mkdirSync(dir, { recursive: true });

const markerFile = join(dir, "hook-fired.txt");
const notifyScript = join(dir, "notify.mjs");

// Write a hook script that just creates a marker file (no HTTP)
writeFileSync(
  notifyScript,
  `import { writeFileSync } from "fs";\nwriteFileSync(${JSON.stringify(markerFile)}, "fired at " + new Date().toISOString() + "\\n");\n`,
  "utf-8",
);

function esc(s) {
  return s.replace(/\\/g, "\\\\");
}

const hookCmd = `"${esc(execPath)}" "${esc(notifyScript)}"`;
const settings = {
  hooks: {
    Stop: [{ matcher: "", hooks: [{ type: "command", command: hookCmd }] }],
  },
};
const settingsPath = join(dir, "settings.json");
writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");

console.log("Settings file:", settingsPath);
console.log("Marker file:  ", markerFile);
console.log("Hook command: ", hookCmd);
console.log("");
console.log(
  "Spawning: claude.cmd -p 'Say exactly: HOOK_TEST' --settings",
  settingsPath,
);
console.log("");

const p = pty.spawn(
  "claude.cmd",
  [
    "--dangerously-skip-permissions",
    "--settings",
    settingsPath,
    "-p",
    "Say exactly one word: HOOK_TEST_DONE",
  ],
  {
    name: "xterm-color",
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: ENV,
  },
);

let output = "";
p.onData((data) => {
  output += data;
  process.stdout.write(data);
});

await new Promise((resolve) => {
  const timer = setTimeout(() => {
    console.log("\n[timeout after 30s]");
    p.kill();
    resolve();
  }, 30000);

  p.onExit(() => {
    clearTimeout(timer);
    resolve();
  });
});

// Give hook time to run (it's async)
await new Promise((r) => setTimeout(r, 1000));

console.log("\n\n=== RESULTS ===");
const strippedOutput = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
console.log(
  "Output contained HOOK_TEST_DONE:",
  strippedOutput.includes("HOOK_TEST_DONE"),
);
console.log("Marker file exists:", existsSync(markerFile));
if (existsSync(markerFile)) {
  console.log("Marker content:", readFileSync(markerFile, "utf-8").trim());
}
