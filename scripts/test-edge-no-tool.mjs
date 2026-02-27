import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";

// ── 1. Create temp dir ────────────────────────────────────────────────────────
const tmpDir = mkdtempSync(join(tmpdir(), "claude-no-tool-"));
const loggerPath = join(tmpDir, "hook-logger.mjs");
const logFile = join(tmpDir, "hooks.log");
const settingsPath = join(tmpDir, "settings.json");

console.log("Temp dir:", tmpDir);

// ── 2. Write hook-logger.mjs ──────────────────────────────────────────────────
writeFileSync(
  loggerPath,
  `\
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

// ── 3. Escape paths for JSON string embedding ─────────────────────────────────
const esc = (s) => s.replace(/\\/g, "\\\\");
const nodeExe = esc(process.execPath);
const loggerE = esc(loggerPath);
const logFileE = esc(logFile);

// ── 4. Write settings.json ────────────────────────────────────────────────────
const settings = {
  hooks: {
    Stop: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `"${nodeExe}" "${loggerE}" Stop "${logFileE}"`,
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
            command: `"${nodeExe}" "${loggerE}" PreToolUse "${logFileE}"`,
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
            command: `"${nodeExe}" "${loggerE}" PostToolUse "${logFileE}"`,
          },
        ],
      },
    ],
  },
};
writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
console.log("settings.json written:");
console.log(JSON.stringify(settings, null, 2));

// ── 5. Build env — strip CLAUDECODE ──────────────────────────────────────────
const env = { ...process.env };
delete env.CLAUDECODE;

// ── 6. Spawn Claude ───────────────────────────────────────────────────────────
const args = [
  "-p",
  "Reply with exactly: PURE_TEXT_RESPONSE_OK. Use no tools whatsoever.",
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
  "--dangerously-skip-permissions",
  "--settings",
  settingsPath,
];

console.log("\nSpawning: claude", args.join(" "), "\n");

const proc = spawn("claude", args, { shell: true, env });

let stdoutBuf = "";
let stderrBuf = "";

proc.stdout.on("data", (d) => {
  stdoutBuf += d.toString();
});
proc.stderr.on("data", (d) => {
  stderrBuf += d.toString();
});

proc.on("close", (code) => {
  console.log(`\nClaude process exited with code: ${code}`);

  // ── 7. Wait 2000ms for hooks to flush ──────────────────────────────────────
  setTimeout(() => {
    // ── 8. Print stream-json events ─────────────────────────────────────────
    console.log("\n=== STREAM-JSON EVENTS (raw stdout) ===");
    console.log(stdoutBuf || "(empty)");

    if (stderrBuf) {
      console.log("\n=== STDERR ===");
      console.log(stderrBuf);
    }

    // ── 9. Print hooks.log ───────────────────────────────────────────────────
    console.log("\n=== hooks.log CONTENTS ===");
    if (existsSync(logFile)) {
      const raw = readFileSync(logFile, "utf8");
      console.log(raw || "(empty file)");
    } else {
      console.log("(hooks.log does not exist — no hooks fired)");
    }

    // ── 10. Parse and verdict ────────────────────────────────────────────────
    let hookEntries = [];
    if (existsSync(logFile)) {
      const lines = readFileSync(logFile, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const line of lines) {
        try {
          hookEntries.push(JSON.parse(line));
        } catch {
          hookEntries.push({ raw: line });
        }
      }
    }

    const stopFired = hookEntries.some((e) => e.event === "Stop");
    const preToolFired = hookEntries.some((e) => e.event === "PreToolUse");
    const postToolFired = hookEntries.some((e) => e.event === "PostToolUse");

    // Check env var visibility from Stop entry
    const stopEntry = hookEntries.find((e) => e.event === "Stop");
    const envVisible = stopEntry ? stopEntry.sessionId !== "(not set)" : false;

    // Parse stream-json to find assistant message
    let assistantText = "";
    const jsonLines = stdoutBuf.trim().split("\n").filter(Boolean);
    for (const line of jsonLines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "assistant" && obj.message?.content) {
          for (const block of obj.message.content) {
            if (block.type === "text") assistantText += block.text;
          }
        }
        // stream-json result event
        if (obj.type === "result" && obj.result) {
          assistantText = assistantText || obj.result;
        }
      } catch {
        /* skip non-JSON lines */
      }
    }

    console.log("\n=== VERDICT ===");
    console.log(
      `Assistant text: ${assistantText.trim() || "(not found in stream-json)"}`,
    );
    console.log(`Stop fired?        ${stopFired ? "YES ✓" : "NO ✗"}`);
    console.log(
      `PreToolUse fired?  ${preToolFired ? "YES (unexpected)" : "NO ✓ (correct — no tools used)"}`,
    );
    console.log(
      `PostToolUse fired? ${postToolFired ? "YES (unexpected)" : "NO ✓ (correct — no tools used)"}`,
    );
    console.log(
      `Env var visible?   ${envVisible ? "YES ✓" : "NO (not set or Stop never fired)"}`,
    );
    console.log(`Hook entries total: ${hookEntries.length}`);

    console.log("\n=== HYPOTHESIS RESULT ===");
    if (stopFired && !preToolFired) {
      console.log(
        "PASS: Stop fires for pure-text responses (no tools). Hypothesis holds.",
      );
    } else if (!stopFired) {
      console.log(
        "FAIL: Stop did NOT fire. Hypothesis breaks down for pure-text responses.",
      );
    } else {
      console.log(
        "PARTIAL: Unexpected hook combination — review entries above.",
      );
    }
  }, 2000);
});

proc.on("error", (err) => {
  console.error("Failed to spawn claude:", err);
  process.exit(1);
});
