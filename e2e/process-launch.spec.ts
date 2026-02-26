import { test, expect } from "@playwright/test";

// Integration tests against a real Claude process.
// These tests do NOT mock the API or the terminal WebSocket.
// Claude must be available in PATH (the `claude` or `claude.cmd` command).
//
// The pty-manager spawns Claude immediately on handover via -p <spec>, so
// by the time the browser WebSocket connects the session may already be in
// completedSessions. The tests therefore observe both live status transitions
// AND the raw replay bytes for evidence that Claude actually ran.

// A spec that produces several lines of output, giving Claude enough work to
// stay in the Thinking/Typing state for several seconds so the browser can
// connect and observe a live status transition.
const SPEC =
  "List every month of the year, one per line. Then list the days of the week, one per line.";
const WORKING_DIR = process.cwd();

test.describe.serial("Claude Code process launch", () => {
  let repoId = "";
  let taskId = "";
  let sessionId = "";

  test.beforeAll(async ({ request }) => {
    const repoRes = await request.post("/api/repos", {
      data: { name: "e2e-process-launch", path: WORKING_DIR },
    });
    expect(repoRes.ok()).toBeTruthy();
    const repo = (await repoRes.json()) as { id: string };
    repoId = repo.id;

    const taskRes = await request.post("/api/tasks", {
      data: {
        title: "Process launch verification",
        status: "Backlog",
        priority: "Low",
        spec: SPEC,
        repoId,
      },
    });
    expect(taskRes.ok()).toBeTruthy();
    const task = (await taskRes.json()) as { id: string };
    taskId = task.id;

    // Handover spawns the real Claude PTY immediately via -p flag.
    const handoverRes = await request.post(`/api/tasks/${taskId}/handover`);
    expect(handoverRes.ok()).toBeTruthy();
    const inProgress = (await handoverRes.json()) as { sessionId: string };
    sessionId = inProgress.sessionId;
    expect(sessionId).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    if (taskId) {
      await request.delete(`/api/tasks/${taskId}`);
    }
    if (repoId) {
      await request.delete(`/api/repos/${repoId}`);
    }
  });

  // Criterion 1: the session must pass through Thinking or Typing before Exited.
  //
  // A session that goes Connecting → Exited with no active state means the
  // claude binary was not found, crashed on startup, or exited immediately with
  // a non-zero code before doing any real work.
  //
  // Because Claude spawns immediately on handover and may finish before the
  // browser WebSocket connects, we check two places:
  //   (a) Live JSON status messages received during the connection.
  //   (b) The raw replay bytes — which contain the same PTY output that
  //       triggered thinking/typing detection on the server (spinner chars,
  //       "(thinking)" text, or substantial printable output from Claude typing).
  test("status indicator transitions through Thinking or Typing before Exited", async ({
    page,
  }) => {
    const liveStatuses: string[] = [];
    let replayBase64 = "";

    page.on("websocket", (ws) => {
      if (!ws.url().includes("/ws/terminal")) {
        return;
      }
      ws.on("framereceived", ({ payload }) => {
        try {
          const text =
            typeof payload === "string"
              ? payload
              : Buffer.from(payload).toString("utf8");
          const msg = JSON.parse(text) as {
            type: string;
            value?: string;
            data?: string;
          };
          if (msg.type === "status" && msg.value) {
            liveStatuses.push(msg.value);
          }
          if (msg.type === "replay" && msg.data) {
            replayBase64 = msg.data;
          }
        } catch {
          // binary frame — raw PTY bytes, not a status message
        }
      });
    });

    await page.goto(`/repos/${repoId}/session/${sessionId}`);
    await expect(page.getByRole("status")).toHaveAccessibleName(
      "Claude status: Exited",
      { timeout: 120_000 },
    );

    // (a) Live path: status messages received before the session exited.
    const hadThinkingTypingLive = liveStatuses.some(
      (s) => s === "thinking" || s === "typing",
    );

    // (b) Replay path: scan the raw PTY bytes for the same signals that
    //     parseClaudeStatus uses to detect thinking and typing states.
    const hadThinkingTypingInReplay = (() => {
      if (!replayBase64) {
        return false;
      }
      const raw = Buffer.from(replayBase64, "base64").toString("utf8");
      // Claude Code v2 status text rendered alongside the thinking spinner.
      if (raw.includes("(thinking)")) {
        return true;
      }
      // Spinner animation: carriage-return followed by a spinner character.
      if (/\r[⣾⣽⣻⢿⡿⣟⣯⣷⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✻✶✢·*]/.test(raw)) {
        return true;
      }
      // Substantial printable output: Claude was streaming its response.
      // Use 20 chars as the threshold — enough to confirm a real response but
      // low enough to work even when Claude's response is concise.
      /* eslint-disable no-control-regex */
      const printable = raw
        .replace(
          /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])/g,
          "",
        )
        .replace(/[^\x20-\x7e]/g, "")
        /* eslint-enable no-control-regex */
        .replace(/\s/g, "");
      return printable.length > 20;
    })();

    expect(hadThinkingTypingLive || hadThinkingTypingInReplay).toBe(true);
  });

  // Criterion 2: terminal must contain Claude output beyond the injected spec.
  // A terminal that shows only the spec echo means Claude received the task
  // but produced no response — the session silently failed.
  test("terminal contains Claude output beyond the injected spec", async ({
    page,
  }) => {
    // Session is already complete. The server replays the full terminal buffer
    // so the client can see everything Claude produced.
    await page.goto(`/repos/${repoId}/session/${sessionId}`);

    // Wait for "Session ended." — written by the client after the replay content
    // is fully flushed, so it acts as a reliable render-complete sentinel.
    await expect(
      page.locator(".xterm-rows").getByText(/Session ended/),
    ).toBeVisible({ timeout: 30_000 });

    const terminalText =
      (await page.locator(".xterm-rows").textContent()) ?? "";
    // In -p mode the spec is not echoed to the terminal — only Claude's response
    // and the client-side "Session ended." line appear. Strip that suffix and
    // assert Claude produced meaningful output (at least 20 chars of response text).
    const responseText = terminalText.replace(/Session ended\.\s*$/, "").trim();
    expect(responseText.length).toBeGreaterThan(20);
  });

  // Criterion 3: terminal must not show spawn error messages.
  // ENOENT, "not found", or "Error:" as terminal content means the claude
  // binary itself failed to start rather than the session completing normally.
  test("terminal does not show spawn error messages", async ({ page }) => {
    await page.goto(`/repos/${repoId}/session/${sessionId}`);

    // Wait for the terminal to be fully populated before reading its content.
    await expect(
      page.locator(".xterm-rows").getByText(/Session ended/),
    ).toBeVisible({ timeout: 30_000 });

    const terminalText =
      (await page.locator(".xterm-rows").textContent()) ?? "";
    expect(terminalText).not.toMatch(/ENOENT|not found|Error:/);
  });
});
