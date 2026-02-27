import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";

function escapeWinPath(p) {
  return p.replace(/\\/g, "\\\\");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest(label, settingsFile, hooksLogFile) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${label}`);
  console.log("=".repeat(60));

  return new Promise((resolve) => {
    const args = [
      "-p",
      "Say: TIMING_TEST_DONE",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--dangerously-skip-permissions",
      "--settings",
      settingsFile,
    ];

    console.log(`Spawning: claude ${args.join(" ")}`);

    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn("claude", args, { shell: true, env });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    let processExitTs = null;

    child.on("close", async (code) => {
      processExitTs = Date.now();
      console.log(
        `\nProcess 'close' event fired at: ${processExitTs} (exit code: ${code})`,
      );

      // Wait 2000ms for hooks to flush
      console.log("Waiting 2000ms for hooks to flush...");
      await sleep(2000);

      // Read hooks log
      let hookWriteTs = null;
      let hookEntry = null;
      if (existsSync(hooksLogFile)) {
        const lines = readFileSync(hooksLogFile, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean);
        // Find the Stop hook entry
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.event === "Stop") {
              hookEntry = entry;
              hookWriteTs = entry.ts;
            }
          } catch {
            // ignore parse errors
          }
        }
      } else {
        console.log("hooks.log does NOT exist — hook never ran!");
      }

      if (hookWriteTs !== null) {
        const delta = hookWriteTs - processExitTs;
        console.log(`\n--- RESULTS for: ${label} ---`);
        console.log(`  processExitTs : ${processExitTs}`);
        console.log(`  hookWriteTs   : ${hookWriteTs}`);
        console.log(`  delta         : ${delta} ms`);
        console.log(`  Hook entry    : ${JSON.stringify(hookEntry)}`);
        if (delta <= 0) {
          console.log(
            `  VERDICT: Hook wrote BEFORE (or exactly at) process exit. delta=${delta}ms (IDEAL)`,
          );
        } else {
          console.log(`  VERDICT: Hook wrote AFTER process exit by ${delta}ms`);
        }
      } else {
        console.log(`  VERDICT: No Stop hook entry found in log!`);
      }

      if (stdout)
        console.log(
          `\n[stdout excerpt (last 500 chars)]:\n${stdout.slice(-500)}`,
        );
      if (stderr)
        console.log(
          `\n[stderr excerpt (last 300 chars)]:\n${stderr.slice(-300)}`,
        );

      resolve({ processExitTs, hookWriteTs, hookEntry, code });
    });

    child.on("error", (err) => {
      console.error("Spawn error:", err);
      resolve({
        processExitTs: Date.now(),
        hookWriteTs: null,
        hookEntry: null,
        code: -1,
      });
    });
  });
}

async function main() {
  const tmpDir = mkdtempSync(join(tmpdir(), "claude-hook-timing-"));
  console.log(`Temp dir: ${tmpDir}`);

  const nodeExe = escapeWinPath(process.execPath);
  const loggerFile = join(tmpDir, "hook-logger.mjs");
  const hooksLogFast = join(tmpDir, "hooks-fast.log");
  const hooksLogSlow = join(tmpDir, "hooks-slow.log");
  const settingsFast = join(tmpDir, "settings-fast.json");
  const settingsSlow = join(tmpDir, "settings-slow.json");

  // Write the hook logger script
  const loggerSource = `
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
  writeFileSync(loggerFile, loggerSource);

  const loggerPath = escapeWinPath(loggerFile);
  const fastLogPath = escapeWinPath(hooksLogFast);
  const slowLogPath = escapeWinPath(hooksLogSlow);

  // FAST settings — direct logger
  const fastStopCmd = `"${nodeExe}" "${loggerPath}" Stop "${fastLogPath}"`;
  const fastSettings = {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: fastStopCmd,
            },
          ],
        },
      ],
    },
  };
  writeFileSync(settingsFast, JSON.stringify(fastSettings, null, 2));

  // SLOW settings — 500ms delay then logger
  const slowStopCmd = `"${nodeExe}" -e "setTimeout(() => {}, 500)" && "${nodeExe}" "${loggerPath}" Stop "${slowLogPath}"`;
  const slowSettings = {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: slowStopCmd,
            },
          ],
        },
      ],
    },
  };
  writeFileSync(settingsSlow, JSON.stringify(slowSettings, null, 2));

  console.log("\nSettings files written.");
  console.log(`  Fast settings: ${settingsFast}`);
  console.log(`  Slow settings: ${settingsSlow}`);
  console.log(`  Logger script: ${loggerFile}`);

  // --- TEST 1: Fast hook ---
  const fastResult = await runTest(
    "FAST HOOK (no delay)",
    settingsFast,
    hooksLogFast,
  );

  // --- TEST 2: Slow hook (500ms delay) ---
  const slowResult = await runTest(
    "SLOW HOOK (500ms delay)",
    settingsSlow,
    hooksLogSlow,
  );

  // --- FINAL SUMMARY ---
  console.log(`\n${"=".repeat(60)}`);
  console.log("FINAL SUMMARY");
  console.log("=".repeat(60));

  function summarize(label, result, logFile) {
    const { processExitTs, hookWriteTs } = result;
    if (hookWriteTs === null) {
      console.log(`[${label}] Hook did NOT complete (no log entry).`);
      return;
    }
    const delta = hookWriteTs - processExitTs;
    if (delta <= 0) {
      console.log(
        `[${label}] Hook wrote BEFORE process exit. delta=${delta}ms (IDEAL — HTTP calls are safe)`,
      );
    } else {
      console.log(
        `[${label}] Hook wrote AFTER process exit by ${delta}ms (fire-and-forget risk!)`,
      );
    }
    console.log(`  Log file: ${logFile}`);
  }

  summarize("FAST HOOK", fastResult, hooksLogFast);
  summarize("SLOW HOOK", slowResult, hooksLogSlow);

  if (slowResult.hookWriteTs !== null) {
    console.log(
      "\nSlow hook DID complete successfully — Claude waited for the 500ms hook.",
    );
  } else {
    console.log(
      "\nSlow hook did NOT complete — Claude may have exited before the hook finished.",
    );
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
