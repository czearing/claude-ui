import type { Page } from "@playwright/test";

import { test, expect, MOCK_TASKS } from "./fixtures";
import type { Task } from "./fixtures";

const BACKLOG_TASK = MOCK_TASKS.find((t) => t.id === "task-backlog")!;
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

test("task with non-empty spec description launches Claude and navigates to the session page", async ({
  page,
}) => {
  // A non-empty spec signals to pty-manager that there is real work to do.
  // The server spawns a Claude session and returns a sessionId. The user then
  // navigates to the board and clicks the In Progress task to open the session.
  const taskWithSpec: Task = {
    ...BACKLOG_TASK,
    spec: "Build a login form with email and password fields.",
  };
  let tasks = MOCK_TASKS.map((t) =>
    t.id === "task-backlog" ? taskWithSpec : t,
  );

  await routeTasks(page, () => tasks);

  // Track whether the browser ever opens a terminal WebSocket — we expect it
  // to connect once the session page loads after the user clicks the task card.
  let wsConnected = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serverWs: any;
  await page.routeWebSocket("**/ws/terminal*", (ws) => {
    wsConnected = true;
    serverWs = ws;
  });

  // Handover returns "In Progress" with a sessionId — the task moves out of
  // the Backlog and gains a session that can be opened from the Board.
  await page.route("**/api/tasks/task-backlog/handover", async (route) => {
    tasks = tasks.map((t) =>
      t.id === "task-backlog"
        ? {
            ...t,
            status: "In Progress" as const,
            sessionId: "session-spec-123",
          }
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

  // The task is now In Progress — it disappears from the backlog list.
  await expect(page.getByText("Backlog item")).not.toBeVisible();

  // Navigate to the Board where the In Progress task is now listed.
  // handleSelectTask on the Board detects task.sessionId and calls router.push
  // to the session URL.
  await page.goto("/repos/repo-1/board");
  await expect(page.getByText("Backlog item")).toBeVisible();
  await page.getByText("Backlog item").click();

  // Clicking an In Progress task card with a sessionId navigates to the session.
  await expect(page).toHaveURL(/\/repos\/repo-1\/session\/session-spec-123/);

  // The session page mounts useTerminalSocket which opens the WebSocket;
  // poll until the routeWebSocket handler has fired.
  await expect.poll(() => wsConnected, { timeout: 5000 }).toBe(true);

  // Wait for serverWs to be populated by the handler, then push output.
  // This simulates pty-manager forwarding Claude's first line of output.
  await expect.poll(() => serverWs, { timeout: 5000 }).toBeDefined();
  serverWs.send(Buffer.from("Analyzing your request...\r\n"));

  // xterm's DOM renderer writes the bytes into .xterm-rows; confirm the text
  // is visible to the user — proving the pipeline pty→WS→xterm is wired up.
  await expect(
    page.locator(".xterm-rows").getByText(/Analyzing your request/),
  ).toBeVisible({ timeout: 5000 });
});

test("task with whitespace-only spec advances directly to Review without launching a terminal", async ({
  page,
}) => {
  // A spec containing only whitespace is treated as empty by the server —
  // there is nothing for Claude to do, so no pty session is spawned and
  // the task jumps straight to "Review".
  const taskWithBlankSpec: Task = {
    ...BACKLOG_TASK,
    spec: "   \n\t  ",
  };
  let tasks = MOCK_TASKS.map((t) =>
    t.id === "task-backlog" ? taskWithBlankSpec : t,
  );

  await routeTasks(page, () => tasks);

  // If this ever flips to true, it means a terminal was unexpectedly spawned
  // for a blank spec — which would be a regression.
  let wsConnected = false;
  await page.routeWebSocket("**/ws/terminal*", (_ws) => {
    wsConnected = true;
  });

  // Handover returns "Review" with no sessionId — handleHandover in AppShell
  // does NOT navigate because there is no sessionId to push to.
  await page.route("**/api/tasks/task-backlog/handover", async (route) => {
    tasks = tasks.map((t) =>
      t.id === "task-backlog" ? { ...t, status: "Review" as const } : t,
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

  // invalidateQueries re-fetches the task list; the task is now "Review" so
  // the Backlog filter removes it from the visible list.
  await expect(page.getByText("Backlog item")).not.toBeVisible();

  // The user must remain on the tasks page — no session navigation should
  // have occurred since the handover response carried no sessionId.
  expect(page.url()).not.toMatch(/\/session\//);

  // Navigate to the board to verify the task landed in the Review column.
  await page.goto("/repos/repo-1/board");
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();

  // Confirm "Backlog item" now appears under the Review heading on the board.
  await expect(page.getByText("Backlog item")).toBeVisible();

  // Checked last so the earlier assertions have time to settle — if wsConnected
  // were true it would mean a pty session was wrongly created for blank content.
  expect(wsConnected).toBe(false);
});

test("session page terminal contains Claude output after handover and not only the bare prompt", async ({
  page,
}) => {
  // Capture the server-side end of the WebSocket so we can push output that
  // simulates what pty-manager would forward from the Claude subprocess.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serverWs: any;
  await page.routeWebSocket("**/ws/terminal*", (ws) => {
    serverWs = ws;
  });

  // Navigate directly to the session page for an already-running task.
  // IN_PROGRESS_TASK.sessionId is "session-abc", so the terminal WS URL
  // will be wss://…/ws/terminal?sessionId=session-abc (or similar).
  await page.goto(`/repos/repo-1/session/${IN_PROGRESS_TASK.sessionId}`);

  // Wait for the routeWebSocket handler to fire — this confirms the browser
  // has opened the WebSocket and the connection is established.
  await expect.poll(() => serverWs, { timeout: 5000 }).toBeDefined();

  // Push a realistic Claude response line followed by the shell prompt.
  // The two sends produce two separate WebSocket frames, matching how
  // pty-manager streams output incrementally from the subprocess.
  serverWs.send(Buffer.from("I will implement the requested feature.\r\n"));
  serverWs.send(Buffer.from("❯"));

  // xterm's DOM renderer writes the decoded bytes into .xterm-rows; confirm
  // the substantive output line reached the screen.
  await expect(
    page
      .locator(".xterm-rows")
      .getByText(/I will implement the requested feature/),
  ).toBeVisible({ timeout: 5000 });

  // Read the full terminal text and strip all whitespace for a compact
  // comparison — if the result were just "❯" the terminal would contain
  // nothing meaningful, indicating the output frames were silently dropped.
  const terminalText = await page.locator(".xterm-rows").textContent();
  expect(terminalText?.replace(/\s/g, "")).not.toBe("❯");
});
