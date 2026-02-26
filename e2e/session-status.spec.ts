import { test, expect, MOCK_TASKS } from "./fixtures";

const IN_PROGRESS_TASK = MOCK_TASKS.find((t) => t.id === "task-ip")!;

test("status messages from server update the status indicator", async ({
  page,
}) => {
  // Capture the mock WebSocket so we can inject messages from the "server" side.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serverWs: any;
  await page.routeWebSocket("**/ws/terminal*", (ws) => {
    serverWs = ws;
  });

  await page.goto(`/repos/repo-1/session/${IN_PROGRESS_TASK.sessionId}`);

  // Wait until the browser WebSocket handshake completes.
  await expect.poll(() => serverWs).toBeDefined();

  // Before any status message, the indicator starts at "Connecting".
  await expect(page.getByRole("status")).toHaveAccessibleName(
    "Claude status: Connecting",
  );

  // Server sends { type: "status", value: "thinking" } — Claude received the
  // spec and is processing it.
  serverWs.send(JSON.stringify({ type: "status", value: "thinking" }));

  await expect(page.getByRole("status")).toHaveAccessibleName(
    "Claude status: Thinking",
  );

  // Server sends { type: "status", value: "waiting" } — Claude has finished
  // thinking and is waiting for input.
  serverWs.send(JSON.stringify({ type: "status", value: "waiting" }));

  await expect(page.getByRole("status")).toHaveAccessibleName(
    "Claude status: Waiting",
  );
});
