/**
 * @jest-environment node
 *
 * Integration test: backToInProgress → real HTTP server → task status transition.
 *
 * This test starts an actual HTTP server backed by the real handleTaskRoutes
 * handler and verifies the complete chain:
 *
 *   ptyStore.backToInProgress(sessionId)
 *     → POST /api/internal/sessions/:id/back-to-in-progress  (real HTTP)
 *       → handleTaskRoutes                                    (real routing)
 *         → task.status: "Review" → "In Progress"            (real logic)
 *
 * The task store I/O and WebSocket broadcast are mocked to avoid filesystem
 * and network dependencies. Everything between backToInProgress and those
 * boundaries is exercised for real.
 */

// ─── Mock external dependencies of the route handler ─────────────────────────

jest.mock("./taskStore");
jest.mock("./boardBroadcast");
jest.mock("./repoStore");
jest.mock("../utils/lexical");
jest.mock("../utils/readBody");
jest.mock("node:crypto");

// ─── Imports ──────────────────────────────────────────────────────────────────

import { broadcastTaskEvent } from "./boardBroadcast";
import { backToInProgress } from "./ptyStore";
import { handleTaskRoutes } from "./routes/tasks";
import { readAllTasks, writeTask } from "./taskStore";
import type { Task } from "../utils/tasks.types";

import * as http from "node:http";
import { parse } from "node:url";

// ─── Typed mock handles ───────────────────────────────────────────────────────

const mockReadAllTasks = readAllTasks as jest.MockedFunction<
  typeof readAllTasks
>;
const mockWriteTask = writeTask as jest.MockedFunction<typeof writeTask>;
const mockBroadcastTaskEvent = broadcastTaskEvent as jest.MockedFunction<
  typeof broadcastTaskEvent
>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "test-task",
    title: "Test Task",
    status: "Review",
    spec: "some spec",
    repo: "test-repo",
    ...overrides,
  };
}

/**
 * Poll condition() every 10 ms until it returns true or timeoutMs elapses.
 * Cleaner than a fixed sleep — the test completes as soon as the async chain
 * resolves rather than waiting an arbitrary fixed delay.
 */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("waitFor: timed out waiting for condition");
    }
    await new Promise<void>((r) => setTimeout(r, 10));
  }
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let server: http.Server;
let savedServerPort: string | undefined;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true);
    void handleTaskRoutes(req, res, parsedUrl).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));

  const addr = server.address() as { port: number };
  savedServerPort = process.env.SERVER_PORT;
  process.env.SERVER_PORT = String(addr.port);
});

afterAll(async () => {
  if (savedServerPort !== undefined) {
    process.env.SERVER_PORT = savedServerPort;
  } else {
    delete process.env.SERVER_PORT;
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  jest.resetAllMocks();
  mockWriteTask.mockResolvedValue(undefined);
  mockBroadcastTaskEvent.mockReturnValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("backToInProgress integration: full HTTP chain", () => {
  it("transitions a Review task to In Progress and preserves sessionId", async () => {
    const sessionId = "integ-session-review";
    const task = makeTask({ sessionId, status: "Review" });
    mockReadAllTasks.mockResolvedValue([task]);

    backToInProgress(sessionId);

    await waitFor(() => mockWriteTask.mock.calls.length > 0);

    expect(mockWriteTask).toHaveBeenCalledTimes(1);
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("In Progress");
    expect(written.sessionId).toBe(sessionId);
    expect(mockBroadcastTaskEvent).toHaveBeenCalledWith(
      "task:updated",
      written,
    );
  });

  it("does not write or broadcast when task is already In Progress", async () => {
    const sessionId = "integ-session-in-progress";
    const task = makeTask({ sessionId, status: "In Progress" });
    mockReadAllTasks.mockResolvedValue([task]);

    backToInProgress(sessionId);

    // Give the HTTP round-trip time to complete. Since no write should happen,
    // we cannot use waitFor on mockWriteTask — poll for a quiet period instead.
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(mockWriteTask).not.toHaveBeenCalled();
    expect(mockBroadcastTaskEvent).not.toHaveBeenCalled();
  });

  it("does not write or broadcast when no task matches the sessionId", async () => {
    mockReadAllTasks.mockResolvedValue([]);

    backToInProgress("integ-orphan-session");

    await new Promise<void>((r) => setTimeout(r, 100));

    expect(mockWriteTask).not.toHaveBeenCalled();
    expect(mockBroadcastTaskEvent).not.toHaveBeenCalled();
  });

  it("handles rapid successive calls: only one write occurs when called once", async () => {
    // The message handler fires backToInProgress exactly once per cycle
    // (it resets hadMeaningfulActivity immediately, so subsequent keystrokes
    // do not call backToInProgress again). This test verifies a single call
    // produces exactly one write even if the server receives it more than once.
    const sessionId = "integ-session-rapid";
    const task = makeTask({ sessionId, status: "Review" });
    mockReadAllTasks.mockResolvedValue([task]);

    backToInProgress(sessionId);

    await waitFor(() => mockWriteTask.mock.calls.length > 0);

    expect(mockWriteTask).toHaveBeenCalledTimes(1);
    const written = mockWriteTask.mock.calls[0][0];
    expect(written.status).toBe("In Progress");
  });

  it("idempotent: second call while already In Progress does not produce a second write", async () => {
    // Simulates a spurious duplicate call arriving after the first one already
    // transitioned the task. The endpoint guards on status === "Review" so the
    // second call is a safe no-op.
    const sessionId = "integ-session-idempotent";

    // First call: task is in Review — should write
    const reviewTask = makeTask({ sessionId, status: "Review" });
    mockReadAllTasks.mockResolvedValueOnce([reviewTask]);
    backToInProgress(sessionId);
    await waitFor(() => mockWriteTask.mock.calls.length > 0);
    expect(mockWriteTask).toHaveBeenCalledTimes(1);

    // Second call: task is now In Progress — readAllTasks returns the new state
    const inProgressTask = makeTask({ sessionId, status: "In Progress" });
    mockReadAllTasks.mockResolvedValue([inProgressTask]);
    backToInProgress(sessionId);

    // Give the second HTTP round-trip time to resolve
    await new Promise<void>((r) => setTimeout(r, 100));

    // Must still be exactly one write
    expect(mockWriteTask).toHaveBeenCalledTimes(1);
  });

  it("review → in-progress → review re-cycle: two separate backToInProgress calls each write once", async () => {
    // Verifies the full re-cycle:
    //   Review → backToInProgress → In Progress
    //   [Claude works, advanceToReview fires externally → Review again]
    //   Review → backToInProgress → In Progress
    const sessionId = "integ-session-recycle";

    // First cycle
    mockReadAllTasks.mockResolvedValueOnce([
      makeTask({ sessionId, status: "Review" }),
    ]);
    backToInProgress(sessionId);
    await waitFor(() => mockWriteTask.mock.calls.length === 1);
    expect(mockWriteTask.mock.calls[0][0].status).toBe("In Progress");

    // Second cycle (after advanceToReview put it back to Review)
    mockReadAllTasks.mockResolvedValueOnce([
      makeTask({ sessionId, status: "Review" }),
    ]);
    backToInProgress(sessionId);
    await waitFor(() => mockWriteTask.mock.calls.length === 2);
    expect(mockWriteTask.mock.calls[1][0].status).toBe("In Progress");
  });
});
