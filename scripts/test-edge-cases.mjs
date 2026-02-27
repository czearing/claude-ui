#!/usr/bin/env node
/**
 * test-edge-cases.mjs
 *
 * Runs 4 edge-case tests sequentially to validate the hooks hypothesis:
 *
 *   1. Pure text  — Stop fires even with zero tool calls
 *   2. Timing     — Stop hook completes before/during process exit
 *   3. Concurrent — env var isolated between two simultaneous sessions
 *   4. Multi-tool — Stop fires exactly once after N sequential tool calls
 *
 * Run: node scripts/test-edge-cases.mjs
 */

import { spawn } from "child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const NODE = process.execPath;
const esc = (s) => s.replace(/\\/g, "\\\\");

const { CLAUDECODE: _cc, ...BASE_ENV } = process.env;

function makeTestDir(label) {
  const dir = join(tmpdir(), `claude-edge-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeLogger(dir) {
  const script = join(dir, "hook-logger.mjs");
  writeFileSync(
    script,
    `import { appendFileSync } from "fs";
const eventName = process.argv[2];
const logFile   = process.argv[3];
const sessionId = process.env.CLAUDE_CODE_UI_SESSION_ID ?? "(not set)";
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  let stdinData;
  try { stdinData = JSON.parse(raw); } catch { stdinData = raw.trim() || null; }
  appendFileSync(logFile, JSON.stringify({ event: eventName, sessionId, stdinData, ts: Date.now() }) + "\\n");
});
`,
  );
  return script;
}

function writeSettings(
  dir,
  loggerScript,
  logFile,
  events = ["Stop", "PreToolUse", "PostToolUse"],
) {
  const hooks = {};
  for (const ev of events) {
    hooks[ev] = [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `"${esc(NODE)}" "${esc(loggerScript)}" ${ev} "${esc(logFile)}"`,
          },
        ],
      },
    ];
  }
  const settingsFile = join(dir, "settings.json");
  writeFileSync(settingsFile, JSON.stringify({ hooks }, null, 2));
  return settingsFile;
}

function spawnClaude(prompt, settingsFile, dir, sessionId, extraArgs = []) {
  return new Promise((resolve) => {
    const events = [];
    let raw = "";
    const processCloseTs = { value: 0 };

    const child = spawn(
      "claude",
      [
        "--dangerously-skip-permissions",
        "--settings",
        settingsFile,
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "-p",
        prompt,
        ...extraArgs,
      ],
      {
        cwd: dir,
        env: { ...BASE_ENV, CLAUDE_CODE_UI_SESSION_ID: sessionId },
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child.stdout.on("data", (chunk) => {
      raw += chunk.toString();
      const lines = raw.split("\n");
      raw = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          /* skip */
        }
      }
    });

    child.stderr.on("data", () => {}); // suppress

    child.on("close", (code) => {
      processCloseTs.value = Date.now();
      setTimeout(
        () =>
          resolve({
            events,
            exitCode: code,
            processCloseTs: processCloseTs.value,
          }),
        2000,
      );
    });
  });
}

function readHookLog(logFile) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
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
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

function pass(msg) {
  console.log(`  PASS  ${msg}`);
}
function fail(msg) {
  console.log(`  FAIL  ${msg}`);
}
function info(msg) {
  console.log(`  INFO  ${msg}`);
}

// ─── Test 1: Pure text (no tool calls) ───────────────────────────────────────

async function testPureText() {
  section("TEST 1: Pure text — Stop fires with zero tool calls");
  const dir = makeTestDir("pure-text");
  const sessionId = randomUUID();
  const logFile = join(dir, "hooks.log");
  const logger = writeLogger(dir);
  const settings = writeSettings(dir, logger, logFile);

  const { events } = await spawnClaude(
    "Reply with exactly the words: PURE_TEXT_OK — nothing else, no tools.",
    settings,
    dir,
    sessionId,
  );

  const entries = readHookLog(logFile);
  const stopCount = entries.filter((e) => e.event === "Stop").length;
  const preToolCount = entries.filter((e) => e.event === "PreToolUse").length;
  const resultEvent = events.find((e) => e.type === "result");

  info(
    `stream-json event types: ${events.map((e) => (e.subtype ? `${e.type}/${e.subtype}` : e.type)).join(", ")}`,
  );
  info(`Stop hook fires: ${stopCount}`);
  info(`PreToolUse hook fires: ${preToolCount} (want 0)`);
  info(`result subtype: ${resultEvent?.subtype ?? "none"}`);

  stopCount === 1
    ? pass("Stop fired exactly once")
    : fail(`Stop fired ${stopCount} times`);
  preToolCount === 0
    ? pass("PreToolUse did NOT fire (pure text confirmed)")
    : fail(`PreToolUse fired ${preToolCount} times unexpectedly`);
  resultEvent?.subtype === "success"
    ? pass("stream-json result=success")
    : fail(`result=${resultEvent?.subtype}`);

  rmSync(dir, { recursive: true, force: true });
}

// ─── Test 2: Hook timing ──────────────────────────────────────────────────────

async function testTiming() {
  section("TEST 2: Timing — hook completes before/after process exit");
  const dir = makeTestDir("timing");
  const sessionId = randomUUID();
  const logFile = join(dir, "hooks.log");
  const logger = writeLogger(dir);
  const settings = writeSettings(dir, logger, logFile, ["Stop"]);

  const { events, processCloseTs } = await spawnClaude(
    "Say: TIMING_OK",
    settings,
    dir,
    sessionId,
  );

  const entries = readHookLog(logFile);
  const stopEntry = entries.find((e) => e.event === "Stop");

  if (!stopEntry) {
    fail("Stop hook never fired — cannot measure timing");
  } else {
    const delta = stopEntry.ts - processCloseTs;
    info(
      `Hook write timestamp vs process close: ${delta > 0 ? "+" : ""}${delta}ms`,
    );
    info(
      `(negative = hook wrote before Node saw close event; positive = hook wrote after)`,
    );
    delta <= 500
      ? pass(
          `Hook completed within 500ms of process close (delta=${delta}ms) — HTTP call is safe`,
        )
      : fail(
          `Hook completed ${delta}ms after process close — HTTP call may be risky`,
        );
  }

  const resultEvent = events.find((e) => e.type === "result");
  resultEvent?.subtype === "success"
    ? pass("stream-json result=success")
    : fail(`result=${resultEvent?.subtype}`);

  rmSync(dir, { recursive: true, force: true });
}

// ─── Test 3: Concurrent session isolation ────────────────────────────────────

async function testConcurrent() {
  section(
    "TEST 3: Concurrent — env var isolated between simultaneous sessions",
  );

  const makeSession = (label) => {
    const dir = makeTestDir(`concurrent-${label}`);
    const sessionId = `session-${label}-${randomUUID()}`;
    const logFile = join(dir, "hooks.log");
    const logger = writeLogger(dir);
    const settings = writeSettings(dir, logger, logFile, ["Stop"]);
    return { dir, sessionId, logFile, settings, label };
  };

  const a = makeSession("A");
  const b = makeSession("B");

  const [resA, resB] = await Promise.all([
    spawnClaude("Say: CONCURRENT_A_OK", a.settings, a.dir, a.sessionId),
    spawnClaude("Say: CONCURRENT_B_OK", b.settings, b.dir, b.sessionId),
  ]);

  const entriesA = readHookLog(a.logFile);
  const entriesB = readHookLog(b.logFile);

  info(
    `Session A entries: ${entriesA.length}, Session B entries: ${entriesB.length}`,
  );

  const aHasA = entriesA.some((e) => e.sessionId === a.sessionId);
  const aHasB = entriesA.some((e) => e.sessionId === b.sessionId);
  const bHasB = entriesB.some((e) => e.sessionId === b.sessionId);
  const bHasA = entriesB.some((e) => e.sessionId === a.sessionId);

  aHasA
    ? pass("Session A hook logged session-A ID")
    : fail("Session A hook did NOT log session-A ID");
  bHasB
    ? pass("Session B hook logged session-B ID")
    : fail("Session B hook did NOT log session-B ID");
  !aHasB
    ? pass("Session A hook has NO session-B contamination")
    : fail("Session A hook logged session-B ID (contamination!)");
  !bHasA
    ? pass("Session B hook has NO session-A contamination")
    : fail("Session B hook logged session-A ID (contamination!)");

  rmSync(a.dir, { recursive: true, force: true });
  rmSync(b.dir, { recursive: true, force: true });
}

// ─── Test 4: Multi-tool — Stop fires exactly once ────────────────────────────

async function testMultiTool() {
  section("TEST 4: Multi-tool — Stop fires exactly once after N tool calls");
  const dir = makeTestDir("multi-tool");
  const sessionId = randomUUID();
  const logFile = join(dir, "hooks.log");
  const logger = writeLogger(dir);
  const settings = writeSettings(dir, logger, logFile);

  const { events } = await spawnClaude(
    "Use the Bash tool three separate times: run 'echo step1', then 'echo step2', then 'echo step3'. Report all outputs.",
    settings,
    dir,
    sessionId,
  );

  const entries = readHookLog(logFile);
  const stopCount = entries.filter((e) => e.event === "Stop").length;
  const preToolCount = entries.filter((e) => e.event === "PreToolUse").length;
  const postToolCount = entries.filter((e) => e.event === "PostToolUse").length;
  const resultEvents = events.filter((e) => e.type === "result");

  info(`Stop fires: ${stopCount} (want 1)`);
  info(`PreToolUse fires: ${preToolCount} (want >= 3)`);
  info(`PostToolUse fires: ${postToolCount} (want >= 3)`);
  info(`stream-json result events: ${resultEvents.length} (want 1)`);

  stopCount === 1
    ? pass("Stop fired exactly once")
    : fail(`Stop fired ${stopCount} times (not 1)`);
  preToolCount >= 3
    ? pass(`PreToolUse fired ${preToolCount} times (once per tool call)`)
    : fail(`PreToolUse fired only ${preToolCount} times`);
  postToolCount >= 3
    ? pass(`PostToolUse fired ${postToolCount} times`)
    : fail(`PostToolUse fired only ${postToolCount} times`);
  resultEvents.length === 1
    ? pass("stream-json result fired exactly once")
    : fail(`stream-json result fired ${resultEvents.length} times`);

  rmSync(dir, { recursive: true, force: true });
}

// ─── Run all ──────────────────────────────────────────────────────────────────

console.log("Edge case validation for hooks hypothesis");
console.log("==========================================");
console.log("Running 4 tests sequentially...");

try {
  await testPureText();
  await testTiming();
  await testConcurrent();
  await testMultiTool();
} catch (err) {
  console.error("\nUnexpected error:", err);
  process.exit(1);
}

console.log(`\n${"═".repeat(60)}`);
console.log("  All tests complete.");
console.log("═".repeat(60));
