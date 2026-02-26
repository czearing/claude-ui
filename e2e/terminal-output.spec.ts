import { test, expect, MOCK_TASKS } from "./fixtures";

const IN_PROGRESS_TASK = MOCK_TASKS.find((t) => t.id === "task-ip")!;

test("browser sends resize as first message on connect", async ({ page }) => {
  const messages: string[] = [];

  await page.routeWebSocket("**/ws/terminal*", (ws) => {
    ws.onMessage((message) => {
      if (typeof message === "string") {
        messages.push(message);
      }
    });
  });

  await page.goto(`/repos/repo-1/session/${IN_PROGRESS_TASK.sessionId}`);

  // Wait for the browser to send at least one message after the handshake.
  await expect.poll(() => messages.length).toBeGreaterThan(0);

  // The first message must be a resize — pty-manager needs the terminal dimensions
  // before injecting any spec. Without this, Claude's output is misformatted and
  // the state machine can misread the prompt character.
  const firstMessage = JSON.parse(messages[0]) as {
    type: string;
    cols?: number;
    rows?: number;
  };
  expect(firstMessage.type).toBe("resize");
  expect(firstMessage.cols).toBeGreaterThan(0);
  expect(firstMessage.rows).toBeGreaterThan(0);
});

test("typing in the terminal sends the keystroke to the server", async ({
  page,
}) => {
  const messages: Array<string | Buffer> = [];

  await page.routeWebSocket("**/ws/terminal*", (ws) => {
    ws.onMessage((message) => {
      messages.push(message);
    });
  });

  await page.goto(`/repos/repo-1/session/${IN_PROGRESS_TASK.sessionId}`);

  // Wait for the resize message — confirms the socket is open and the onopen
  // handler has fired, so ws.readyState === OPEN when we type.
  await expect
    .poll(() =>
      messages.some((m) => {
        try {
          return (
            (JSON.parse(m as string) as { type: string }).type === "resize"
          );
        } catch {
          return false;
        }
      }),
    )
    .toBe(true);

  // Click to give xterm keyboard focus, then press a key.
  await page.locator('[data-testid="terminal-container"]').click();
  await page.keyboard.press("a");

  // xterm fires onData("a"), which calls ws.send("a"). The raw character
  // arrives at the server as a plain text-frame message — not wrapped in JSON.
  // If this message is missing, the user cannot interact with Claude mid-task.
  await expect
    .poll(() => messages.some((m) => m === "a" || m.toString() === "a"))
    .toBe(true);
});

test("server close writes reconnect countdown and opens a new connection", async ({
  page,
}) => {
  let connectionCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serverWs: any;

  await page.routeWebSocket("**/ws/terminal*", (ws) => {
    connectionCount++;
    serverWs = ws;
  });

  await page.goto(`/repos/repo-1/session/${IN_PROGRESS_TASK.sessionId}`);

  // Wait for the first connection.
  await expect.poll(() => serverWs).toBeDefined();

  // Server abruptly drops the socket.
  serverWs.close();

  // onclose writes "Disconnected. Reconnecting in 1s…" to the terminal.
  // RECONNECT_BASE_MS = 1000, reconnectAttempt = 0 at first close →
  // delay = 1000 * 2^0 = 1000 ms → secs = 1.
  await expect(
    page.locator(".xterm-rows").getByText(/Reconnecting in 1s/),
  ).toBeVisible({ timeout: 3000 });

  // After the 1-second timer fires, connect() opens a new WebSocket to the
  // same session URL. The routeWebSocket handler runs a second time.
  await expect.poll(() => connectionCount, { timeout: 5000 }).toBe(2);
});

test("binary output from server renders in the terminal", async ({ page }) => {
  // Capture the WebSocket route so we can push data from the "server" side.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let serverWs: any;
  await page.routeWebSocket("**/ws/terminal*", (ws) => {
    serverWs = ws;
  });

  await page.goto(`/repos/repo-1/session/${IN_PROGRESS_TASK.sessionId}`);

  // Wait for the browser WebSocket handshake to complete.
  await expect.poll(() => serverWs).toBeDefined();

  // Server sends raw bytes — the client checks `event.data instanceof ArrayBuffer`
  // and writes them directly to xterm: `t.write(new Uint8Array(event.data))`.
  // Sending a Buffer causes Playwright to emit a binary WebSocket frame, which
  // arrives on the client as an ArrayBuffer (because `ws.binaryType = "arraybuffer"`
  // is set in useTerminalSocket).
  serverWs.send(Buffer.from("Hello from Claude"));

  // xterm's DOM renderer populates .xterm-rows with the decoded text.
  // Playwright reads the row content to confirm the bytes reached the screen.
  await expect(
    page.locator(".xterm-rows").getByText("Hello from Claude"),
  ).toBeVisible({ timeout: 5000 });
});
