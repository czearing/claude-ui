import { spawn } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

// ── helpers ──────────────────────────────────────────────────────────────────

function winPath(p) {
  return p.replace(/\\/g, "\\\\");
}

function makeSession(label) {
  const id = `${label}-${randomUUID()}`;
  const dir = mkdtempSync(join(tmpdir(), `claude-concurrent-${label}-`));
  const logFile = join(dir, "hooks.log");
  const loggerFile = join(dir, "hook-logger.mjs");

  // Write hook-logger.mjs
  const loggerSrc = `
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
`.trimStart();

  writeFileSync(loggerFile, loggerSrc, "utf8");

  const nodePath = winPath(process.execPath);
  const loggerPath = winPath(loggerFile);
  const logPath = winPath(logFile);

  const hookCmd = `${nodePath} ${loggerPath}`;

  const settings = {
    hooks: {
      Stop: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: `${hookCmd} Stop ${logPath}`,
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
              command: `${hookCmd} PreToolUse ${logPath}`,
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
              command: `${hookCmd} PostToolUse ${logPath}`,
            },
          ],
        },
      ],
    },
  };

  const settingsFile = join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2), "utf8");

  return { id, dir, logFile, settingsFile };
}

function runClaude(session) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    // Remove any existing CLAUDE_CODE_UI_SESSION_ID
    delete env.CLAUDE_CODE_UI_SESSION_ID;
    // Remove CLAUDECODE if present (as instructed)
    delete env.CLAUDECODE;
    // Set this session's ID
    env.CLAUDE_CODE_UI_SESSION_ID = session.id;

    const args = [
      "-p",
      "Say: CONCURRENT_TEST_DONE",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--dangerously-skip-permissions",
      "--settings",
      session.settingsFile,
    ];

    console.log(`[${session.id}] Spawning claude in: ${session.dir}`);

    const proc = spawn("claude", args, {
      shell: true,
      cwd: session.dir,
      env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      console.log(`[${session.id}] Process exited with code ${code}`);
      resolve({ session, stdout, stderr, code });
    });

    proc.on("error", (err) => {
      reject(
        new Error(`Failed to spawn claude for ${session.id}: ${err.message}`),
      );
    });
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log("=== Concurrent Session Hook Isolation Test ===\n");

const sessionA = makeSession("session-A");
const sessionB = makeSession("session-B");

console.log(`Session A ID: ${sessionA.id}`);
console.log(`Session B ID: ${sessionB.id}`);
console.log(`Session A dir: ${sessionA.dir}`);
console.log(`Session B dir: ${sessionB.dir}`);
console.log(`Session A log: ${sessionA.logFile}`);
console.log(`Session B log: ${sessionB.logFile}`);
console.log("");

console.log("Spinning up BOTH Claude processes simultaneously...\n");

const [resultA, resultB] = await Promise.all([
  runClaude(sessionA),
  runClaude(sessionB),
]);

console.log("\n--- Session A stdout (last 500 chars) ---");
console.log(resultA.stdout.slice(-500) || "(empty)");
console.log("--- Session A stderr (last 300 chars) ---");
console.log(resultA.stderr.slice(-300) || "(empty)");

console.log("\n--- Session B stdout (last 500 chars) ---");
console.log(resultB.stdout.slice(-500) || "(empty)");
console.log("--- Session B stderr (last 300 chars) ---");
console.log(resultB.stderr.slice(-300) || "(empty)");

console.log("\nWaiting 2000ms for hooks to flush...");
await new Promise((r) => setTimeout(r, 2000));

// ── Read logs ─────────────────────────────────────────────────────────────────

function readLog(logFile, label) {
  if (!existsSync(logFile)) {
    console.log(`[${label}] hooks.log does not exist`);
    return [];
  }
  const raw = readFileSync(logFile, "utf8").trim();
  if (!raw) {
    console.log(`[${label}] hooks.log is empty`);
    return [];
  }
  const entries = raw.split("\n").map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { parseError: line };
    }
  });
  return entries;
}

const logsA = readLog(sessionA.logFile, "session-A");
const logsB = readLog(sessionB.logFile, "session-B");

console.log("\n=== Session A hooks.log ===");
if (logsA.length === 0) {
  console.log("  (no entries)");
} else {
  logsA.forEach((e, i) => console.log(`  [${i}]`, JSON.stringify(e)));
}

console.log("\n=== Session B hooks.log ===");
if (logsB.length === 0) {
  console.log("  (no entries)");
} else {
  logsB.forEach((e, i) => console.log(`  [${i}]`, JSON.stringify(e)));
}

// ── Verdict ───────────────────────────────────────────────────────────────────

console.log("\n=== VERDICT ===\n");

const idA = sessionA.id;
const idB = sessionB.id;

// Check session A's Stop hook
const stopA = logsA.filter((e) => e.event === "Stop");
const stopB = logsB.filter((e) => e.event === "Stop");

const aHasOwnId = logsA.some((e) => e.sessionId === idA);
const aHasForeignId = logsA.some((e) => e.sessionId === idB);
const bHasOwnId = logsB.some((e) => e.sessionId === idB);
const bHasForeignId = logsB.some((e) => e.sessionId === idA);

console.log(`Session A Stop hook entries: ${stopA.length}`);
console.log(`Session B Stop hook entries: ${stopB.length}`);
console.log("");
console.log(
  `Did session-A's hooks log session-A's own ID?   ${aHasOwnId ? "YES ✓" : "NO ✗"}`,
);
console.log(
  `Did session-A's hooks log session-B's ID?       ${aHasForeignId ? "YES (CONTAMINATION!) ✗" : "NO ✓"}`,
);
console.log("");
console.log(
  `Did session-B's hooks log session-B's own ID?   ${bHasOwnId ? "YES ✓" : "NO ✗"}`,
);
console.log(
  `Did session-B's hooks log session-A's ID?       ${bHasForeignId ? "YES (CONTAMINATION!) ✗" : "NO ✓"}`,
);
console.log("");

const crossContamination = aHasForeignId || bHasForeignId;
if (crossContamination) {
  console.log(
    "RESULT: CROSS-CONTAMINATION DETECTED — sessions shared env vars!",
  );
} else if (!aHasOwnId && !bHasOwnId) {
  console.log(
    "RESULT: INCONCLUSIVE — neither session's Stop hook fired (hooks.log empty or missing)",
  );
} else if (!aHasOwnId || !bHasOwnId) {
  console.log("RESULT: PARTIAL — one session's Stop hook did not fire");
} else {
  console.log(
    "RESULT: PASS — each session's hook saw only its own session ID. No cross-contamination.",
  );
}

console.log("\n=== All log entries (both sessions) ===");
console.log("Session A all entries:");
logsA.forEach((e) => console.log("  ", JSON.stringify(e)));
console.log("Session B all entries:");
logsB.forEach((e) => console.log("  ", JSON.stringify(e)));
