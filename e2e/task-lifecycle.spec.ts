/**
 * Category 2: Full Task Lifecycle
 *
 * These tests exercise the real server stack end-to-end — no mocked API routes
 * and no mocked WebSockets. Every assertion goes through:
 *   real HTTP API → real taskStore → real boardBroadcast → real /ws/board
 *   WebSocket → real React Query setQueryData → real board re-render.
 *
 * The only simplification: we simulate pty-manager's advance-to-review callback
 * by calling POST /api/internal/sessions/:id/advance-to-review directly. This
 * exercises every server-side code path that can break without needing a live
 * Claude process.
 */
import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import type { Task } from "../src/utils/tasks.types";

interface RepoJson {
  id: string;
  name: string;
  path: string;
}

// Serial mode prevents tests within a browser project from running in parallel,
// which avoids board-state interference when they share the same repo.
test.describe.configure({ mode: "serial" });

test.describe("Full Task Lifecycle", () => {
  let repoId: string;
  const taskIds: string[] = [];

  // Fetch the first configured repo once per browser project. This avoids
  // concurrent writes to repos.json when both browser workers run beforeEach
  // simultaneously.
  test.beforeAll(async ({ request }) => {
    const res = await request.get("/api/repos");
    expect(res.ok(), "GET /api/repos must succeed").toBe(true);
    const repos = (await res.json()) as RepoJson[];
    expect(
      repos.length,
      "At least one repo must be configured — add one in the app first",
    ).toBeGreaterThan(0);
    repoId = repos[0].id;
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
  ): Promise<Task> {
    const res = await request.post("/api/tasks", {
      data: { title, repoId, priority: "Medium", spec: "" },
    });
    expect(res.status()).toBe(201);
    const task = (await res.json()) as Task;
    taskIds.push(task.id);
    return task;
  }

  test("task moves to Review column after advance-to-review without page reload", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "Lifecycle task");
    const sessionId = `e2e-${task.id}`;

    // Move task to In Progress so it appears on the board with the agent badge.
    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    await page.goto(`/repos/${repoId}/board`);
    await expect(page.getByText("Lifecycle task")).toBeVisible();

    // Capture badge count now — other pre-existing In Progress tasks may exist.
    const countBefore = await page.getByText("Agent Processing...").count();
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // Simulate pty-manager calling advance-to-review on the real server.
    // This triggers: taskStore.writeTask → boardBroadcast → /ws/board message.
    const advRes = await request.post(
      `/api/internal/sessions/${sessionId}/advance-to-review`,
    );
    expect(advRes.status()).toBe(204);

    // The board WebSocket (real connection) delivers the task:updated event.
    // React Query updates in place — no page reload needed.
    await expect(page.getByText("Agent Processing...")).toHaveCount(
      countBefore - 1,
    );

    // The task card is still visible — it moved to the Review column.
    await expect(page.getByText("Lifecycle task")).toBeVisible();
  });

  test("task card shows Agent Processing badge immediately after moving to In Progress", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "Handover task");

    // Navigate to board while task is Backlog — it is not shown on the board
    // at all (board only shows In Progress / Review / Done).
    await page.goto(`/repos/${repoId}/board`);
    await expect(page.getByText("Handover task")).not.toBeVisible();

    const countBefore = await page.getByText("Agent Processing...").count();

    // Move task to In Progress via the real PATCH endpoint.
    // The server broadcasts task:updated immediately after writing.
    const sessionId = `e2e-${task.id}`;
    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    // The real board WebSocket delivers the update — the task card appears with
    // its badge without any page reload.
    await expect(page.getByText("Agent Processing...")).toHaveCount(
      countBefore + 1,
    );
    await expect(page.getByText("Handover task")).toBeVisible();
  });

  test("navigating to board during active session shows task as In Progress with agent badge", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "Active session task");
    const sessionId = `e2e-${task.id}`;

    // Set task to In Progress BEFORE the browser navigates — tests the initial
    // GET /api/tasks load path, not the WebSocket update path.
    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    await page.goto(`/repos/${repoId}/board`);

    await expect(
      page.getByRole("heading", { name: "In Progress" }),
    ).toBeVisible();
    await expect(page.getByText("Active session task")).toBeVisible();

    // Badge count must be at least 1 — our task contributes one.
    await expect(page.getByText("Agent Processing...").first()).toBeVisible();
  });
});
