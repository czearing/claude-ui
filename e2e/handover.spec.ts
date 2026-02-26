import type { Page } from "@playwright/test";

import { test, expect, MOCK_TASKS } from "./fixtures";
import type { Task } from "./fixtures";

const IN_PROGRESS_TASK = MOCK_TASKS.find((t) => t.id === "task-ip")!;

// Intercepts GET /api/tasks?repoId=... with a mutable task list.
// The pattern **/api/tasks* (single *) only matches URLs where the path
// ends at "tasks" with no further slashes — i.e. it matches the list
// endpoint but NOT /api/tasks/:id/handover or /api/tasks/:id/recall.
async function routeTasks(page: Page, getTasks: () => Task[]) {
  await page.route("**/api/tasks*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: getTasks() });
    } else {
      await route.continue();
    }
  });
}

test("Send to Agent triggers handover and task disappears from backlog", async ({
  page,
}) => {
  let tasks = [...MOCK_TASKS];

  await routeTasks(page, () => tasks);

  // Mock the handover endpoint — flip the task to In Progress in our mutable list
  // so the subsequent tasks re-fetch no longer includes it in the Backlog filter.
  await page.route("**/api/tasks/task-backlog/handover", async (route) => {
    tasks = tasks.map((t) =>
      t.id === "task-backlog"
        ? { ...t, status: "In Progress" as const, sessionId: "session-new-123" }
        : t,
    );
    await route.fulfill({ json: tasks.find((t) => t.id === "task-backlog") });
  });

  await page.goto("/repos/repo-1/tasks");
  await expect(page.getByText("Backlog item")).toBeVisible();

  // The parent row div captures pointer events (it handles row selection),
  // so force the click directly onto the button element.
  await page
    .getByRole("button", { name: "Send Backlog item to agent" })
    .click({ force: true });

  // useHandoverTask.onSuccess calls invalidateQueries, triggering a re-fetch.
  // The task is now "In Progress" so the Backlog filter drops it from the list.
  await expect(page.getByText("Backlog item")).not.toBeVisible();
});

test("handover with no spec advances task directly to Review without spawning a session", async ({
  page,
}) => {
  // BACKLOG_TASK has spec: null — the server skips pty-manager and sets status
  // directly to "Review" (no sessionId is assigned).
  let tasks = [...MOCK_TASKS];

  await routeTasks(page, () => tasks);

  await page.route("**/api/tasks/task-backlog/handover", async (route) => {
    tasks = tasks.map((t) =>
      t.id === "task-backlog" ? { ...t, status: "Review" as const } : t,
    );
    await route.fulfill({ json: tasks.find((t) => t.id === "task-backlog") });
  });

  await page.goto("/repos/repo-1/tasks");
  await expect(page.getByText("Backlog item")).toBeVisible();

  await page
    .getByRole("button", { name: "Send Backlog item to agent" })
    .click({ force: true });

  // Task is now "Review" — not shown in the Backlog list
  await expect(page.getByText("Backlog item")).not.toBeVisible();
});

test("clicking an In Progress task on the board navigates to its session page", async ({
  page,
}) => {
  await routeTasks(page, () => MOCK_TASKS);

  // Mock the terminal WebSocket so the session page does not stall waiting for
  // a pty-manager connection that won't arrive in this test environment.
  await page.routeWebSocket("**/ws/terminal*", (_ws) => {});

  await page.goto("/repos/repo-1/board");
  // IN_PROGRESS_TASK (task-ip) has sessionId "session-abc".
  // AppShell.handleSelectTask detects sessionId and calls router.push.
  await expect(page.getByText("In progress task")).toBeVisible();
  await page.getByText("In progress task").click();

  await expect(page).toHaveURL(/\/repos\/repo-1\/session\/session-abc/);
});

test("session page renders back navigation and status indicator", async ({
  page,
}) => {
  await page.routeWebSocket("**/ws/terminal*", (_ws) => {});

  await page.goto(`/repos/repo-1/session/${IN_PROGRESS_TASK.sessionId}`);

  await expect(page.getByRole("link", { name: /back/i })).toBeVisible();
});

test("recalling an In Progress task moves it back to Backlog", async ({
  page,
}) => {
  let tasks = [...MOCK_TASKS];

  await routeTasks(page, () => tasks);

  await page.route("**/api/tasks/task-ip/recall", async (route) => {
    tasks = tasks.map((t) =>
      t.id === "task-ip"
        ? { ...t, status: "Backlog" as const, sessionId: undefined }
        : t,
    );
    await route.fulfill({ json: tasks.find((t) => t.id === "task-ip") });
  });

  await page.goto("/repos/repo-1/board");
  await expect(page.getByText("In progress task")).toBeVisible();

  // The three-dot menu on the In Progress card has "Move to Backlog"
  await page.getByLabel("Task actions").first().click();
  await page.getByText("Move to Backlog").click();

  // After recall the task is "Backlog" — it's excluded from the board
  await expect(page.getByText("In progress task")).not.toBeVisible();
});
