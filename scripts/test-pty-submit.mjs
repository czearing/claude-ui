#!/usr/bin/env node
/**
 * test-pty-submit.mjs
 *
 * Empirically tests which PTY write method causes Claude Code to
 * auto-submit input without requiring a manual Enter press on Windows.
 *
 * Run: node scripts/test-pty-submit.mjs
 */

import * as pty from "node-pty";

const { CLAUDECODE: _cc, ...ENV } = process.env;

// Use the current working directory which is already trusted by Claude Code.
// Using a fresh temp dir would trigger the workspace trust dialog every time.
const BASE_DIR = process.cwd();

// Use a multi-line prompt to better match production specs.
const PROMPT =
  "Say exactly the word: AUTOSUBMIT_SUCCESS\n\nThis is line 2 of the spec.\nThis is line 3.";
const SUCCESS_TOKEN = "AUTOSUBMIT_SUCCESS";
const TIMEOUT_MS = 30000;

async function testMethod(label, injectFn) {
  process.stdout.write(`  ${label} ... `);

  return new Promise((resolve) => {
    const p = pty.spawn("claude.cmd", ["--dangerously-skip-permissions"], {
      name: "xterm-color",
      cols: 120,
      rows: 30,
      cwd: BASE_DIR,
      env: ENV,
    });

    let output = "";
    let trustHandled = false; // true once we've sent \r to accept the trust dialog
    let trustAt = 0; // output.length at the moment we sent \r
    let injected = false;
    let finished = false;

    const done = (success) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        p.kill();
      } catch (_) {
        /* ignore kill errors */
      }
      if (!success) {
        const stripped = output
          .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
          .slice(-500);
        console.log(`FAIL\n    --- last output ---\n${stripped}\n    ---`);
      } else {
        console.log("PASS");
      }
      resolve(success);
    };

    const timer = setTimeout(() => done(false), TIMEOUT_MS);

    p.onData((data) => {
      output += data;

      if (output.includes(SUCCESS_TOKEN)) {
        done(true);
        return;
      }

      // If the workspace trust dialog appears, accept it (press Enter to confirm
      // the default "Yes, I trust this folder" selection). We use accumulated
      // output so we don't miss text split across chunks.
      if (!trustHandled && output.includes("Enter to confirm")) {
        trustHandled = true;
        setTimeout(() => {
          trustAt = output.length;
          p.write("\r");
        }, 200);
        return;
      }

      // Inject the spec on the first real Claude input prompt (❯).
      // If a trust dialog was shown, only look at output after we accepted it
      // so the trust dialog's own ❯ doesn't trigger injection.
      // If no trust dialog, look at all output (trustAt stays 0).
      const relevant = output.slice(trustAt);
      if (
        !injected &&
        relevant.includes("\u276f") &&
        !relevant.includes("Enter to confirm")
      ) {
        injected = true;
        injectFn(p, PROMPT);
      }
    });

    p.onExit(() => {
      if (finished) return;
      const success = output.includes(SUCCESS_TOKEN);
      done(success);
    });
  });
}

console.log("PTY auto-submit method test");
console.log("============================");
console.log(`Working dir: ${BASE_DIR}`);
console.log(
  `Testing which write() method auto-submits to Claude Code on Windows\n`,
);
console.log(
  "(Each test spawns Claude and waits up to 30s for auto-response)\n",
);

// Test methods in order — stop after first PASS to save API cost
const methods = [
  [
    "A: plain text (newlines→spaces) + \\r",
    (p, prompt) => p.write(`${prompt.replace(/\n/g, " ")}\r`),
  ],
  [
    "B: bracketed paste + \\r",
    (p, prompt) => p.write(`\x1b[200~${prompt}\x1b[201~\r`),
  ],
  [
    "C: bracketed paste, then delayed \\r (100ms)",
    (p, prompt) => {
      p.write(`\x1b[200~${prompt}\x1b[201~`);
      setTimeout(() => p.write("\r"), 100);
    },
  ],
  [
    "D: plain text (with literal newlines) + \\r",
    (p, prompt) => p.write(`${prompt}\r`),
  ],
];

// Run all methods to see which ones work (don't stop early)
const results = [];
for (const [label, fn] of methods) {
  const ok = await testMethod(label, fn);
  results.push([label, ok]);
}
const winner = results.find(([, ok]) => ok)?.[0] ?? null;

console.log("");
console.log("Results:");
for (const [label, ok] of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"} — ${label}`);
}
console.log("");
if (winner) {
  console.log(`First winner: ${winner}`);
} else {
  console.log("No method worked — all timed out.");
  console.log(
    "Consider switching handover sessions to -p (non-interactive) mode.",
  );
}
