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

test.describe("Spec Content Behavior", () => {
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

  test("task with non-empty spec description launches Claude and navigates to the session page", async ({
    page,
    request,
  }) => {
    // A non-empty spec tells pty-manager there is real work to do.
    // The server spawns a Claude session and returns a sessionId, and
    // AppShell.handleHandover automatically navigates to the session page.
    const task = await createTask(
      request,
      "Spec content launch task",
      "Write a one-line comment saying hello.",
    );

    let wsConnected = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let serverWs: any;
    await page.routeWebSocket("**/ws/terminal*", (ws) => {
      wsConnected = true;
      serverWs = ws;
    });

    await page.goto(`/repos/${repoId}/tasks`);
    await expect(page.getByText(task.title)).toBeVisible();

    await page
      .getByRole("button", { name: `Send ${task.title} to agent` })
      .click({ force: true });

    // With a non-empty spec, handover spawns Claude and sets the task to
    // In Progress. The Backlog list refreshes and the task disappears.
    await expect(page.getByText(task.title)).not.toBeVisible();

    // Navigate to the Board where the In Progress task is now listed.
    // The Backlog component does not auto-navigate after handover — the user
    // goes to the Board and clicks the task card to open the session page.
    await page.goto(`/repos/${repoId}/board`);
    await expect(page.getByText(task.title)).toBeVisible();
    await page.getByText(task.title).click();

    // Clicking an In Progress task on the Board navigates to the session page.
    await expect(page).toHaveURL(
      new RegExp(`/repos/${repoId}/session/`),
      { timeout: 10000 },
    );

    // The session page mounts useTerminalSocket which opens the WebSocket;
    // poll until the routeWebSocket handler has fired.
    await expect.poll(() => wsConnected, { timeout: 5000 }).toBe(true);

    // Wait for serverWs to be populated by the handler, then push output.
    // This simulates pty-manager forwarding Claude's first line of output.
    await expect.poll(() => serverWs, { timeout: 5000 }).toBeDefined();
    serverWs.send(Buffer.from("Analyzing your request...\r\n"));

    // xterm's DOM renderer writes the bytes into .xterm-rows; confirm the text
    // is visible — proving the pipeline pty→WS→xterm is wired up.
    await expect(
      page.locator(".xterm-rows").getByText(/Analyzing your request/),
    ).toBeVisible({ timeout: 5000 });
  });

  test("task with whitespace-only spec advances directly to Review without launching a terminal", async ({
    page,
    request,
  }) => {
    // A spec containing only whitespace is treated as empty by the server —
    // there is nothing for Claude to do, so no pty session is spawned and
    // the task jumps straight to "Review".
    const task = await createTask(
      request,
      "Whitespace spec task",
      "   \n\t  ",
    );

    // If this ever fires, it means a terminal was unexpectedly spawned
    // for a blank spec — which would be a regression.
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

    // Must stay on tasks page — no session navigation should have occurred
    // since the handover response carried no sessionId.
    expect(page.url()).not.toMatch(/\/session\//);

    // Navigate to the board to verify the task landed in the Review column.
    await page.goto(`/repos/${repoId}/board`);
    await expect(page.getByText(task.title)).toBeVisible();

    // Checked last so the earlier assertions have time to settle — if true,
    // it would mean a pty session was wrongly created for blank content.
    expect(wsConnected).toBe(false);
  });

  test("session page terminal contains Claude output after handover and not only the bare prompt", async ({
    page,
    request,
  }) => {
    // Create a real task and set it to In Progress with a known sessionId so
    // the session page loads correctly. The WebSocket is mocked so we can
    // push output without needing a real Claude process for this UI-focused test.
    const task = await createTask(request, "Terminal render task");
    const sessionId = `e2e-terminal-${task.id}`;

    await request.patch(`/api/tasks/${task.id}`, {
      data: { status: "In Progress", sessionId },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let serverWs: any;
    await page.routeWebSocket("**/ws/terminal*", (ws) => {
      serverWs = ws;
    });

    await page.goto(`/repos/${repoId}/session/${sessionId}`);

    // Wait for the routeWebSocket handler to fire — confirms the browser has
    // opened the WebSocket and the connection is established.
    await expect.poll(() => serverWs, { timeout: 5000 }).toBeDefined();

    // Push a realistic Claude response line followed by the shell prompt.
    // Two separate frames match how pty-manager streams output incrementally.
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
});
