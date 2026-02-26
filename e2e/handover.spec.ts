import { test, expect } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";

import type { Task } from "../src/utils/tasks.types";

interface RepoJson {
  id: string;
  name: string;
  path: string;
}

// Serial mode prevents tests from interfering with each other's board state.
test.describe.configure({ mode: "serial" });

test.describe("Handover and Recall", () => {
  let repoId: string;
  const taskIds: string[] = [];

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
    spec: string = "",
  ): Promise<Task> {
    const res = await request.post("/api/tasks", {
      data: { title, repoId, priority: "Medium", spec },
    });
    expect(res.status()).toBe(201);
    const task = (await res.json()) as Task;
    taskIds.push(task.id);
    return task;
  }

  test("Send to Agent triggers handover and task disappears from backlog", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "Handover backlog task");

    await page.goto(`/repos/${repoId}/tasks`);
    await expect(page.getByText(task.title)).toBeVisible();

    // With empty spec, handover skips Claude and sets the task to Review.
    // The Backlog filter excludes Review tasks, so the row disappears.
    await page
      .getByRole("button", { name: `Send ${task.title} to agent` })
      .click({ force: true });

    await expect(page.getByText(task.title)).not.toBeVisible();
  });

  test("handover with no spec advances task directly to Review without spawning a session", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "No spec handover task");

    let wsConnected = false;
    await page.routeWebSocket("**/ws/terminal*", (_ws) => {
      wsConnected = true;
    });

    await page.goto(`/repos/${repoId}/tasks`);
    await expect(page.getByText(task.title)).toBeVisible();

    await page
      .getByRole("button", { name: `Send ${task.title} to agent` })
      .click({ force: true });

    // Task is now Review — not shown in Backlog list.
    await expect(page.getByText(task.title)).not.toBeVisible();

    // No session navigation should have occurred — handover with empty spec
    // does not create a session, so AppShell.handleHandover does not push.
    expect(page.url()).not.toMatch(/\/session\//);

    // Navigate to the board to verify the task landed in the Review column.
    await page.goto(`/repos/${repoId}/board`);
    await expect(page.getByText(task.title)).toBeVisible();

    // No terminal WebSocket should have been opened.
    expect(wsConnected).toBe(false);
  });

  test("clicking an In Progress task on the board navigates to its session page", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "In progress nav task");
    const sessionId = `e2e-nav-${task.id}`;

    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    // Mock the terminal WebSocket so the session page does not stall waiting
    // for a real pty-manager session that does not exist for this test task.
    await page.routeWebSocket("**/ws/terminal*", (_ws) => {});

    await page.goto(`/repos/${repoId}/board`);
    await expect(page.getByText(task.title)).toBeVisible();
    await page.getByText(task.title).click();

    await expect(page).toHaveURL(
      new RegExp(`/repos/${repoId}/session/${sessionId}`),
    );
  });

  test("session page renders back navigation", async ({ page, request }) => {
    const task = await createTask(request, "Session nav task");
    const sessionId = `e2e-session-${task.id}`;

    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    await page.routeWebSocket("**/ws/terminal*", (_ws) => {});

    await page.goto(`/repos/${repoId}/session/${sessionId}`);

    await expect(page.getByRole("link", { name: /back/i })).toBeVisible();
  });

  test("recalling an In Progress task moves it back to Backlog", async ({
    page,
    request,
  }) => {
    const task = await createTask(request, "Recall test task");
    const sessionId = `e2e-recall-${task.id}`;

    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    await page.goto(`/repos/${repoId}/board`);
    await expect(page.getByText(task.title)).toBeVisible();

    // The title is in a <span> inside div.titleRow inside div.header.
    // The "Task actions" button lives in div.headerRight — a sibling of titleRow
    // inside the same div.header. Traversing up 2 levels from the span scopes
    // us precisely to div.header, which has exactly one "Task actions" button.
    await page
      .locator("span", { hasText: new RegExp(`^${task.title}$`) })
      .locator("xpath=../..")
      .getByLabel("Task actions")
      .click({ force: true });

    await page.getByText("Move to Backlog").click();

    // After recall the task status is Backlog — excluded from the board columns.
    await expect(page.getByText(task.title)).not.toBeVisible();
  });
});
