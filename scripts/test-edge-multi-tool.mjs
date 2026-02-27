import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";

// ── 1. Create temp dir ──────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "claude-multi-tool-"));
const logFile = join(dir, "hooks.log");
const hookScript = join(dir, "hook-logger.mjs");

// Escape backslashes for embedding in JSON string values (Windows paths)
const logFileJson = logFile.replace(/\\/g, "\\\\");
const hookScriptJson = hookScript.replace(/\\/g, "\\\\");
const nodeExe = process.execPath.replace(/\\/g, "\\\\");

console.log("Temp dir:", dir);
console.log("Log file:", logFile);
console.log("Node exe:", process.execPath);

// ── 2. Write hook-logger.mjs ────────────────────────────────────────────────
writeFileSync(
  hookScript,
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
`.trimStart(),
);

// ── 3. Write settings.json ──────────────────────────────────────────────────
const settings = {
  hooks: {
    Stop: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `"${nodeExe}" "${hookScriptJson}" Stop "${logFileJson}"`,
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
            command: `"${nodeExe}" "${hookScriptJson}" PreToolUse "${logFileJson}"`,
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
            command: `"${nodeExe}" "${hookScriptJson}" PostToolUse "${logFileJson}"`,
          },
        ],
      },
    ],
  },
};

const settingsFile = join(dir, "settings.json");
writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
console.log("Settings file:", settingsFile);
console.log("Settings JSON:\n" + JSON.stringify(settings, null, 2));

// ── 4. Spawn Claude ─────────────────────────────────────────────────────────
const prompt =
  "Use the Bash tool three times in sequence: first run 'echo step1', then run 'echo step2', then run 'echo step3'. Report all three outputs.";

const args = [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
  "--dangerously-skip-permissions",
  "--settings",
  settingsFile,
  prompt,
];

// Strip CLAUDECODE from env
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key.startsWith("CLAUDECODE")) delete env[key];
}

console.log("\nSpawning: claude", args.map((a) => JSON.stringify(a)).join(" "));

const child = spawn("claude", args, { shell: true, env });

let stdout = "";
let stderr = "";

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  stdout += chunk;
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  stderr += chunk;
});

child.on("error", (err) => {
  console.error("Spawn error:", err);
});

// ── 5. Wait for process close + 2000ms flush ────────────────────────────────
await new Promise((resolve) => {
  child.on("close", (code) => {
    console.log(`\n[claude exited with code ${code}]`);
    setTimeout(resolve, 2000);
  });
});

console.log("\n[Waited 2000ms for hooks to flush]");

// ── 6. Read hooks.log ───────────────────────────────────────────────────────
console.log("\n=== hooks.log contents ===");
if (!existsSync(logFile)) {
  console.log("(hooks.log does not exist — no hooks fired)");
} else {
  const raw = readFileSync(logFile, "utf8");
  console.log(raw);
}

// ── 7. Parse and count hook events ─────────────────────────────────────────
let hookEntries = [];
if (existsSync(logFile)) {
  const lines = readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  for (const line of lines) {
    try {
      hookEntries.push(JSON.parse(line));
    } catch (e) {
      console.error("Failed to parse hook log line:", line);
    }
  }
}

const stopCount = hookEntries.filter((e) => e.event === "Stop").length;
const preToolCount = hookEntries.filter((e) => e.event === "PreToolUse").length;
const postToolCount = hookEntries.filter(
  (e) => e.event === "PostToolUse",
).length;

console.log("=== Hook event counts ===");
console.log(`Stop:        ${stopCount}`);
console.log(`PreToolUse:  ${preToolCount}`);
console.log(`PostToolUse: ${postToolCount}`);

// ── 8. Parse stream-json events ─────────────────────────────────────────────
console.log("\n=== stream-json events (in order) ===");
const streamLines = stdout.split("\n").filter((l) => l.trim());
let streamEvents = [];
for (const line of streamLines) {
  try {
    streamEvents.push(JSON.parse(line));
  } catch {
    // not JSON, skip
  }
}

for (const ev of streamEvents) {
  console.log(JSON.stringify(ev));
}

const resultCount = streamEvents.filter((e) => e.type === "result").length;
console.log(`\nstream-json 'result' event count: ${resultCount}`);

// ── 9. Verdict ───────────────────────────────────────────────────────────────
console.log("\n=== VERDICT ===");
console.log(`Stop count:       ${stopCount}  (expected: 1)`);
console.log(`PreToolUse count: ${preToolCount}  (expected: >= 3)`);
console.log(
  `PostToolUse count:${postToolCount}  (expected: == PreToolUse count)`,
);
console.log(`result event count: ${resultCount}  (expected: 1)`);

const pass = stopCount === 1 && resultCount === 1;
console.log(`\n${pass ? "PASS" : "FAIL"}`);
if (!pass) {
  if (stopCount !== 1)
    console.log(`  REASON: Stop fired ${stopCount} times (expected 1)`);
  if (resultCount !== 1)
    console.log(
      `  REASON: result event fired ${resultCount} times (expected 1)`,
    );
}
