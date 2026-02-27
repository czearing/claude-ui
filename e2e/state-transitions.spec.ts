/**
 * e2e/state-transitions.spec.ts
 *
 * Two-layer tests for In Progress <-> Review task state transitions.
 *
 * Layer 1 (no Claude required): Calls the internal HTTP endpoints directly to
 * verify the state machine and board broadcast pipeline work correctly.
 * These tests pin down the server-side logic independently of Claude.
 *
 * Layer 2 (requires ANTHROPIC_API_KEY + Claude Code installed): Launches a
 * real Claude session via handover, waits for the Stop hook to advance the
 * task to Review, then sends terminal input to verify the task moves back to
 * In Progress. Skip these by default unless the env var is set.
 *
 * Known bugs this test suite exposes (see claudeHookSettings.ts):
 *   - The esc() function double-escapes backslashes before JSON.stringify,
 *     producing invalid Windows paths in the Stop hook command.
 *   - advanceToReview() in ptyStore.ts is dead code and never called.
 */
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import type { Task } from "../src/utils/tasks.types";

interface RepoJson {
  id: string;
  name: string;
  path: string;
}

// Serial mode prevents tests from racing on shared board state.
test.describe.configure({ mode: "serial" });

test.describe("Task State Transitions", () => {
  let repoId: string;
  let repoName: string;
  const taskIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    const res = await request.get("/api/repos");
    expect(res.ok(), "GET /api/repos must succeed").toBe(true);
    const repos = (await res.json()) as RepoJson[];
    expect(
      repos.length,
      "At least one repo must be configured in the app",
    ).toBeGreaterThan(0);
    repoId = repos[0].id;
    repoName = repos[0].name;
  });

  test.afterEach(async ({ request }) => {
    for (const id of taskIds) {
      await request.delete(`/api/tasks/${id}`);
    }
    taskIds.length = 0;
  });

  async function createTask(
    request: APIRequestContext,
    title: string,
    spec = "",
  ): Promise<Task> {
    const res = await request.post("/api/tasks", {
      data: { title, repo: repoName, spec },
    });
    expect(res.status(), `POST /api/tasks for "${title}" must return 201`).toBe(
      201,
    );
    const task = (await res.json()) as Task;
    taskIds.push(task.id);
    return task;
  }

  // Helper to poll the tasks API until a condition is true.
  async function pollTaskStatus(
    request: APIRequestContext,
    taskId: string,
    expectedStatus: string,
    timeoutMs = 10_000,
  ): Promise<void> {
    await expect(async () => {
      const res = await request.get("/api/tasks");
      const tasks = (await res.json()) as Task[];
      const found = tasks.find((t) => t.id === taskId);
      expect(found?.status).toBe(expectedStatus);
    }).toPass({ timeout: timeoutMs });
  }

  // ─── Layer 1: HTTP endpoint tests (no Claude needed) ─────────────────────────
  // These verify the state machine logic and board WebSocket broadcast path
  // independently of Claude Code.

  test("advance-to-review endpoint moves task from In Progress to Review on board", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "STT advance-to-review");
    const sessionId = `e2e-atr-${task.id}`;

    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    await page.goto(`/repos/${repoId}/board`);
    await expect(page.getByText(task.title)).toBeVisible();

    const badgesBefore = await page.getByText("Agent Processing...").count();
    expect(badgesBefore).toBeGreaterThanOrEqual(1);

    // Simulate the Stop hook: POST advance-to-review.
    const res = await request.post(
      `/api/internal/sessions/${sessionId}/advance-to-review`,
    );
    expect(res.status()).toBe(204);

    // Board WebSocket must deliver the task:updated broadcast.
    // The "Agent Processing..." badge disappears when task leaves In Progress.
    await expect(page.getByText("Agent Processing...")).toHaveCount(
      badgesBefore - 1,
      { timeout: 5000 },
    );

    // Task stays on the board, now in the Review column.
    await expect(page.getByText(task.title)).toBeVisible();
  });

  test("back-to-in-progress endpoint moves task from Review to In Progress on board", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "STT back-to-in-progress");
    const sessionId = `e2e-btip-${task.id}`;

    // Set task to Review with a sessionId so the endpoint can find it.
    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "Review", sessionId },
    });

    await page.goto(`/repos/${repoId}/board`);
    // Review tasks are shown on the board but without the "Agent Processing..." badge.
    await expect(page.getByText(task.title)).toBeVisible();
    const badgesBefore = await page.getByText("Agent Processing...").count();

    // Simulate what ptyStore.backToInProgress does: POST back-to-in-progress.
    const res = await request.post(
      `/api/internal/sessions/${sessionId}/back-to-in-progress`,
    );
    expect(res.status()).toBe(204);

    // Board WebSocket must deliver the task:updated broadcast.
    // The "Agent Processing..." badge appears when task enters In Progress.
    await expect(page.getByText("Agent Processing...")).toHaveCount(
      badgesBefore + 1,
      { timeout: 5000 },
    );

    // Task is still on the board, now in the In Progress column.
    await expect(page.getByText(task.title)).toBeVisible();
  });

  test("advance-to-review is a no-op when task status is not In Progress", async ({
    request,
  }) => {
    const task = await createTask(request, "STT no-op advance");
    const sessionId = `e2e-noop-atr-${task.id}`;

    // Backlog is the default. Attach sessionId so the endpoint can find the task.
    await request.patch(`/api/tasks/${task.id}`, { data: { sessionId } });

    const res = await request.post(
      `/api/internal/sessions/${sessionId}/advance-to-review`,
    );
    expect(res.status()).toBe(204);

    // Task must remain Backlog — guard condition (status === "In Progress") failed.
    await pollTaskStatus(request, task.id, "Backlog");
  });

  test("back-to-in-progress is a no-op when task status is not Review", async ({
    request,
  }) => {
    const task = await createTask(request, "STT no-op back");
    const sessionId = `e2e-noop-btip-${task.id}`;

    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    const res = await request.post(
      `/api/internal/sessions/${sessionId}/back-to-in-progress`,
    );
    expect(res.status()).toBe(204);

    // Task must remain In Progress — guard condition (status === "Review") failed.
    await pollTaskStatus(request, task.id, "In Progress");
  });

  test("full round trip: In Progress -> Review -> In Progress via endpoints", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "STT round trip");
    const sessionId = `e2e-rt-${task.id}`;

    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    await page.goto(`/repos/${repoId}/board`);
    await expect(page.getByText(task.title)).toBeVisible();

    const initialBadges = await page.getByText("Agent Processing...").count();
    expect(initialBadges).toBeGreaterThanOrEqual(1);

    // Step 1: In Progress → Review.
    await request.post(`/api/internal/sessions/${sessionId}/advance-to-review`);
    await expect(page.getByText("Agent Processing...")).toHaveCount(
      initialBadges - 1,
      { timeout: 5000 },
    );
    await expect(page.getByText(task.title)).toBeVisible();

    // Step 2: Review → In Progress.
    await request.post(
      `/api/internal/sessions/${sessionId}/back-to-in-progress`,
    );
    await expect(page.getByText("Agent Processing...")).toHaveCount(
      initialBadges,
      { timeout: 5000 },
    );
    await expect(page.getByText(task.title)).toBeVisible();
  });

  // ─── Layer 2: Real Claude session tests ──────────────────────────────────────
  // These tests require ANTHROPIC_API_KEY and an installed `claude` CLI.
  // They exercise the full pipeline: handover -> Stop hook -> advance-to-review
  // and terminal input -> backToInProgress -> back-to-in-progress.
  //
  // The most critical thing NOT to mock here: the Stop hook execution path
  // in claudeHookSettings.ts + pty-manager.ts. That is the path most likely
  // to be broken (double-escaping bug in esc() + JSON.stringify on Windows).

  test.describe("Real Claude session (requires ANTHROPIC_API_KEY)", () => {
    // Shared across the two sequential sub-tests.
    let claudeTask: Task | null = null;
    let claudeSessionId: string | null = null;

    test("handover with real Claude moves task to In Progress then Review via Stop hook", async ({
      page,
      request,
    }) => {
      test.skip(
        !process.env.ANTHROPIC_API_KEY,
        "Set ANTHROPIC_API_KEY to run real Claude tests",
      );

      claudeTask = await createTask(
        request,
        "STT real Claude handover",
        // Minimal spec so Claude completes instantly without side effects.
        "Reply with the single word: done",
      );

      await page.goto(`/repos/${repoId}/board`);
      // Task starts as Backlog — not shown on the board.
      await expect(page.getByText(claudeTask.title)).not.toBeVisible();

      // POST handover: spawns `claude -p "Reply with the single word: done"
      //   --settings <hookSettingsFile> --dangerously-skip-permissions`.
      // The hookSettingsFile contains a Stop hook that calls notify.mjs, which
      // POSTs advance-to-review when Claude finishes its turn.
      const handoverRes = await request.post(
        `/api/tasks/${claudeTask.id}/handover`,
      );
      expect(handoverRes.status(), "Handover must return 200").toBe(200);

      const inProgress = (await handoverRes.json()) as Task;
      expect(
        inProgress.status,
        "Task must be In Progress immediately after handover",
      ).toBe("In Progress");
      expect(
        inProgress.sessionId,
        "Handover must assign a sessionId to the task",
      ).toBeTruthy();
      claudeSessionId = inProgress.sessionId!;

      // Board WebSocket should broadcast the In Progress update.
      await expect(page.getByText(claudeTask.title)).toBeVisible({
        timeout: 10_000,
      });

      // Wait for Claude to complete and the Stop hook to fire advance-to-review.
      // Poll the tasks API — the board WS update may arrive slightly after the
      // file write, and we want to verify the persisted state, not just the UI.
      // Give Claude up to 90 seconds (conservative for API latency).
      await expect(async () => {
        const res = await request.get("/api/tasks");
        const tasks = (await res.json()) as Task[];
        const updated = tasks.find((t) => t.id === claudeTask!.id);
        expect(
          updated?.status,
          "Task must reach Review after Claude finishes its turn",
        ).toBe("Review");
      }).toPass({ timeout: 90_000, intervals: [2_000, 3_000, 5_000, 10_000] });

      // Task is still on the board (in the Review column).
      await expect(page.getByText(claudeTask.title)).toBeVisible();
    });

    test("typing in terminal after Review transitions task back to In Progress", async ({
      page,
      request,
    }) => {
      test.skip(
        !process.env.ANTHROPIC_API_KEY,
        "Set ANTHROPIC_API_KEY to run real Claude tests",
      );
      test.skip(
        !claudeTask || !claudeSessionId,
        "Depends on the previous Claude test completing successfully",
      );

      // Confirm we start from Review before proceeding.
      const checkRes = await request.get("/api/tasks");
      const tasks = (await checkRes.json()) as Task[];
      const current = tasks.find((t) => t.id === claudeTask!.id);
      expect(
        current?.status,
        "Task must be in Review before testing back-to-in-progress",
      ).toBe("Review");

      // Navigate to the session page. The frontend opens a WebSocket to
      // /ws/terminal?sessionId=<id>, which the proxy bridges to pty-manager.
      // pty-manager's wsSessionHandler detects the completed -p session, replays
      // prior output, and spawns `claude --continue --dangerously-skip-permissions`
      // for interactive follow-up. This is the same path as a real user clicking
      // on an In Progress task after it moved to Review.
      await page.goto(`/repos/${repoId}/session/${claudeSessionId}`);

      // Wait for xterm.js to render the terminal widget.
      await page.waitForSelector(".xterm", { timeout: 30_000 });

      // Wait for the --continue session to start and produce output so the
      // session entry is in the pty-manager sessions Map. The message handler
      // checks sessions.get(sessionId) before calling backToInProgress.
      await page.waitForFunction(
        () => {
          const rows = document.querySelector(".xterm-rows");
          return (
            rows !== null &&
            rows.textContent !== null &&
            rows.textContent.trim().length > 0
          );
        },
        { timeout: 30_000 },
      );

      // Click the terminal's hidden textarea to focus it.
      // xterm.js routes keyboard events through .xterm-helper-textarea.
      const textarea = page.locator(".xterm-helper-textarea");
      await textarea.click();

      // Type any input. wsSessionHandler.ts calls backToInProgress(sessionId)
      // BEFORE writing to the PTY for every non-resize message received.
      // The HTTP POST is fire-and-forget — we poll for the state change.
      await page.keyboard.type("continue\r");

      // Poll until the task transitions back to In Progress.
      await expect(async () => {
        const res = await request.get("/api/tasks");
        const allTasks = (await res.json()) as Task[];
        const updated = allTasks.find((t) => t.id === claudeTask!.id);
        expect(
          updated?.status,
          "Task must return to In Progress after terminal input",
        ).toBe("In Progress");
      }).toPass({ timeout: 15_000, intervals: [1_000, 2_000, 3_000] });
    });
  });
});
