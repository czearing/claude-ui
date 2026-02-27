#!/usr/bin/env node
/**
 * test-hook-hypothesis.mjs
 *
 * Verifies the hypothesis that Claude Code hooks (Stop, PreToolUse) + stream-json
 * output can replace fragile ANSI/spinner parsing for task status detection.
 *
 * What this tests:
 *   1. Does `--output-format stream-json` produce clean, parseable JSON events?
 *   2. Does the `Stop` hook fire after Claude finishes its response?
 *   3. Does the `PreToolUse` hook fire before a tool call?
 *   4. Is a custom env var (CLAUDE_CODE_UI_SESSION_ID) accessible inside hooks?
 *   5. What does the stdin payload to each hook actually look like?
 *
 * Run: node scripts/test-hook-hypothesis.mjs
 */

import { spawn, spawnSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Resolve the claude executable path. On Windows, `claude` is a .cmd wrapper
// that Node's spawn won't find without shell:true or an explicit full path.
function resolveClaudeCommand() {
  // 1. Honour an explicit override from the environment
  if (process.env.CLAUDE_CMD)
    return { cmd: process.env.CLAUDE_CMD, shell: false };

  // 2. On Windows, .cmd files cannot be spawned directly — always use shell:true
  //    so cmd.exe resolves the extension automatically.
  if (process.platform === "win32") {
    return { cmd: "claude", shell: true };
  }

  return { cmd: "claude", shell: false };
}

const { cmd: CLAUDE_CMD, shell: USE_SHELL } = resolveClaudeCommand();

// ─── Setup ────────────────────────────────────────────────────────────────────

const SESSION_ID = randomUUID();
const BASE_DIR = join(tmpdir(), `claude-hook-test-${Date.now()}`);
const LOG_FILE = join(BASE_DIR, "hooks.log");
const LOGGER_SCRIPT = join(BASE_DIR, "hook-logger.mjs");
const SETTINGS_FILE = join(BASE_DIR, "settings.json");

mkdirSync(BASE_DIR, { recursive: true });

// Cross-platform hook logger: receives event name + log file path as argv,
// reads stdin (the JSON payload Claude Code sends), logs everything to file.
// Using a node script avoids bash/cmd.exe syntax differences on Windows.
writeFileSync(
  LOGGER_SCRIPT,
  `
import { appendFileSync } from "fs";

const eventName = process.argv[2];
const logFile   = process.argv[3];
const sessionId = process.env.CLAUDE_CODE_UI_SESSION_ID ?? "(not set)";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let stdinData;
  try { stdinData = JSON.parse(raw); } catch { stdinData = raw.trim() || null; }

  const entry = { event: eventName, sessionId, stdinData, ts: Date.now() };
  appendFileSync(logFile, JSON.stringify(entry) + "\\n");
});
`,
);

// Node path — use the same node that's running this script so it's always found.
const NODE = process.execPath;

// Escape backslashes for embedding in a JSON string value (Windows paths).
const esc = (s) => s.replace(/\\/g, "\\\\");

writeFileSync(
  SETTINGS_FILE,
  JSON.stringify(
    {
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: `"${esc(NODE)}" "${esc(LOGGER_SCRIPT)}" Stop "${esc(LOG_FILE)}"`,
              },
            ],
          },
        ],
        PreToolUse: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: `"${esc(NODE)}" "${esc(LOGGER_SCRIPT)}" PreToolUse "${esc(LOG_FILE)}"`,
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: "",
            hooks: [
              {
                type: "command",
                command: `"${esc(NODE)}" "${esc(LOGGER_SCRIPT)}" PostToolUse "${esc(LOG_FILE)}"`,
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  ),
);

// ─── Run ──────────────────────────────────────────────────────────────────────

const PROMPT =
  'Run this exact bash command and report the output: echo "hook-test-success"';

console.log("Hook hypothesis test");
console.log("====================");
console.log(`Session ID  : ${SESSION_ID}`);
console.log(`Working dir : ${BASE_DIR}`);
console.log(`Log file    : ${LOG_FILE}`);
console.log(`Prompt      : "${PROMPT}"`);
console.log("");
console.log(`Spawning: ${CLAUDE_CMD} -p --output-format stream-json ...`);
console.log("");

// Strip CLAUDECODE so Claude Code doesn't refuse to start inside a nested session
const { CLAUDECODE: _cc, ...baseEnv } = process.env;
const env = {
  ...baseEnv,
  CLAUDE_CODE_UI_SESSION_ID: SESSION_ID,
};

const child = spawn(
  CLAUDE_CMD,
  [
    "--dangerously-skip-permissions",
    "--settings",
    SETTINGS_FILE,
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "-p",
    PROMPT,
  ],
  {
    cwd: BASE_DIR,
    env,
    shell: USE_SHELL,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const streamEvents = [];
let rawStdout = "";

child.stdout.on("data", (chunk) => {
  rawStdout += chunk.toString();
  // Parse complete lines as they arrive
  const lines = rawStdout.split("\n");
  rawStdout = lines.pop(); // keep incomplete last line
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      streamEvents.push(event);
      const tag = event.subtype ? `${event.type}/${event.subtype}` : event.type;
      process.stdout.write(`  [stream] ${tag}\n`);
    } catch {
      process.stdout.write(`  [stream/raw] ${line}\n`);
    }
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(`  [stderr] ${chunk.toString()}`);
});

child.on("close", (code) => {
  // Give async hook processes a moment to flush their log writes
  setTimeout(() => {
    printResults(code);
  }, 1500);
});

// ─── Results ──────────────────────────────────────────────────────────────────

function printResults(exitCode) {
  console.log("");
  console.log(`Process exited with code: ${exitCode}`);
  console.log("");

  // --- stream-json events ---
  console.log("─── stream-json events ───────────────────────────────────────");
  if (streamEvents.length === 0) {
    console.log("  (none received — output-format may not be supported)");
  } else {
    for (const e of streamEvents) {
      const summary = JSON.stringify(e).slice(0, 140);
      console.log("  " + summary);
    }
  }
  console.log("");

  // --- hook log ---
  console.log("─── hooks.log ────────────────────────────────────────────────");
  if (!existsSync(LOG_FILE)) {
    console.log("  (file not created — no hooks fired)");
  } else {
    const lines = readFileSync(LOG_FILE, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    if (lines.length === 0) {
      console.log("  (log file empty)");
    } else {
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          console.log(`  [${entry.event}]`);
          console.log(`    sessionId : ${entry.sessionId}`);
          console.log(`    stdinData : ${JSON.stringify(entry.stdinData)}`);
        } catch {
          console.log("  (unparseable line): " + line);
        }
      }
    }
  }
  console.log("");

  // --- verdict ---
  const logText = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : "";
  const hookEntries = logText
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const stopFired = hookEntries.some((e) => e.event === "Stop");
  const preToolFired = hookEntries.some((e) => e.event === "PreToolUse");
  const postToolFired = hookEntries.some((e) => e.event === "PostToolUse");
  const envVarInHook = hookEntries.some((e) => e.sessionId === SESSION_ID);
  const resultEvent = streamEvents.find((e) => e.type === "result");
  const hasAssistant = streamEvents.some((e) => e.type === "assistant");

  console.log("─── Verdict ──────────────────────────────────────────────────");
  console.log(`  Stop hook fired           : ${yn(stopFired)}`);
  console.log(`  PreToolUse hook fired     : ${yn(preToolFired)}`);
  console.log(`  PostToolUse hook fired    : ${yn(postToolFired)}`);
  console.log(`  Env var visible in hook   : ${yn(envVarInHook)}`);
  console.log(`  stream-json assistant evt : ${yn(hasAssistant)}`);
  console.log(
    `  stream-json result evt    : ${resultEvent ? `YES  subtype=${resultEvent.subtype}` : "NO"}`,
  );
  console.log("");

  const hypothesisHolds =
    stopFired && envVarInHook && resultEvent?.subtype === "success";

  if (hypothesisHolds) {
    console.log(
      "✓ HYPOTHESIS CONFIRMED — Stop hook + stream-json result are reliable signals.",
    );
    console.log(
      "  → Replace idle-timer / ANSI-parsing with hooks + result event parsing.",
    );
  } else {
    console.log("✗ HYPOTHESIS NOT CONFIRMED — see details above.");
    if (!stopFired) console.log("  → Stop hook never fired.");
    if (!envVarInHook)
      console.log(
        "  → Env var CLAUDE_CODE_UI_SESSION_ID not visible in hooks.",
      );
    if (!resultEvent) console.log("  → No stream-json result event received.");
  }
  console.log("");

  // Cleanup
  try {
    rmSync(BASE_DIR, { recursive: true, force: true });
  } catch {
    // non-fatal
  }
}

function yn(b) {
  return b ? "YES" : "NO";
}
