import { test, expect } from "@playwright/test";

// Integration tests against a real Claude process.
// These tests do NOT mock the API or the terminal WebSocket.
// Claude must be available in PATH (the `claude` or `claude.cmd` command).
//
// The pty-manager spawns Claude immediately on handover via -p <spec>, so
// by the time the browser WebSocket connects the session is already live.

const SPEC = "Reply with only the word: ready";
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

  // Criterion 1: status must pass through Thinking or Typing before Exited.
  // A session that goes straight from Connecting to Exited means the claude
  // binary crashed or was not found before doing any real work.
  test("status indicator transitions through Thinking or Typing before Exited", async ({
    page,
  }) => {
    await page.goto(`/repos/${repoId}/session/${sessionId}`);

    await expect(page.getByRole("status")).toHaveAccessibleName(
      /Claude status: (Thinking|Typing)/,
      { timeout: 60_000 },
    );

    await expect(page.getByRole("status")).toHaveAccessibleName(
      "Claude status: Exited",
      { timeout: 120_000 },
    );
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
    await expect(page.getByRole("status")).toHaveAccessibleName(
      "Claude status: Exited",
      { timeout: 30_000 },
    );

    const terminalText =
      (await page.locator(".xterm-rows").textContent()) ?? "";
    expect(terminalText.length).toBeGreaterThan(SPEC.length + 50);
  });

  // Criterion 3: terminal must not show spawn error messages.
  // ENOENT, "not found", or "Error:" as terminal content means the claude
  // binary itself failed to start rather than the session completing normally.
  test("terminal does not show spawn error messages", async ({ page }) => {
    await page.goto(`/repos/${repoId}/session/${sessionId}`);
    await expect(page.getByRole("status")).toHaveAccessibleName(
      "Claude status: Exited",
      { timeout: 30_000 },
    );

    const terminalText =
      (await page.locator(".xterm-rows").textContent()) ?? "";
    expect(terminalText).not.toMatch(/ENOENT|not found|Error:/);
  });
});
