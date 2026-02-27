#!/usr/bin/env node
import { execPath } from "process";
import { join } from "path";
import { tmpdir } from "os";
import { writeFileSync, mkdirSync, readFileSync } from "fs";

function esc(s) {
  return s.replace(/\\/g, "\\\\");
}

const sessionId = "debug-session-123";
const serverPort = "3000";
const dir = join(tmpdir(), `claude-hooks-${sessionId}`);
mkdirSync(dir, { recursive: true });
const notifyScriptPath = join(dir, "notify.mjs");

writeFileSync(notifyScriptPath, "// test\n", "utf-8");

const command = `"${esc(execPath)}" "${esc(notifyScriptPath)}" "${serverPort}" "${sessionId}"`;

const settings = {
  hooks: {
    Stop: [{ matcher: "", hooks: [{ type: "command", command }] }],
  },
};

const settingsPath = join(dir, "settings.json");
const json = JSON.stringify(settings, null, 2);
writeFileSync(settingsPath, json, "utf-8");

console.log("execPath:         ", execPath);
console.log("notifyScriptPath: ", notifyScriptPath);
console.log("settingsPath:     ", settingsPath);
console.log("");
console.log("=== command string (as JS) ===");
console.log(command);
console.log("");
console.log("=== settings.json on disk ===");
console.log(readFileSync(settingsPath, "utf-8"));

// Verify: can we parse it back and run the command?
const parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
const parsedCommand = parsed.hooks.Stop[0].hooks[0].command;
console.log("=== parsed command from JSON ===");
console.log(parsedCommand);

// Verify the node exe path embedded in the command exists
const match = parsedCommand.match(/^"([^"]+)"/);
if (match) {
  console.log("");
  console.log("Node path from parsed command:", match[1]);
  import("fs").then(({ existsSync }) => {
    console.log("Node exe exists:", existsSync(match[1]));
  });
}
