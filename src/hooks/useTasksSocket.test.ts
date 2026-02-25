import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useTasksSocket } from "./useTasksSocket";
import type { Task } from "@/utils/tasks.types";

// ─── WebSocket mock ──────────────────────────────────────────────────────────

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  send = jest.fn();
  // close() does NOT auto-trigger onclose — callers that need to simulate a
  // server-initiated close must call ws.onclose?.() directly.  This matches
  // the way the reconnect tests are structured.
  close = jest.fn();
  url: string;
  private static _instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket._instances.push(this);
  }

  static get lastInstance(): MockWebSocket {
    return MockWebSocket._instances[MockWebSocket._instances.length - 1];
  }

  static get instanceCount(): number {
    return MockWebSocket._instances.length;
  }

  static reset() {
    MockWebSocket._instances = [];
  }
}

Object.defineProperty(window, "WebSocket", {
  value: MockWebSocket,
  writable: true,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-001",
    title: "Test Task",
    status: "Backlog",
    priority: "Medium",
    spec: "",
    repoId: "repo-1",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, Wrapper };
}

function sendMessage(data: unknown) {
  MockWebSocket.lastInstance.onmessage?.({
    data: JSON.stringify(data),
  } as MessageEvent);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useTasksSocket", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    jest.clearAllMocks();
  });

  it("connects to the board WS endpoint", () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });
    expect(MockWebSocket.lastInstance.url).toBe("ws://localhost/ws/board");
  });

  it("closes WebSocket on unmount", () => {
    const { Wrapper } = createWrapper();
    const { unmount } = renderHook(() => useTasksSocket(), {
      wrapper: Wrapper,
    });
    unmount();
    expect(MockWebSocket.lastInstance.close).toHaveBeenCalled();
  });

  // ─── onopen catch-up ────────────────────────────────────────────────────

  it("invalidates all tasks queries on WebSocket open to catch up on missed events", () => {
    const { queryClient, Wrapper } = createWrapper();
    queryClient.setQueryData(["tasks", "repo-1"], [makeTask()]);

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    act(() => {
      MockWebSocket.lastInstance.onopen?.({} as Event);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] });
  });

  // ─── task:updated ────────────────────────────────────────────────────────

  it("patches the task in the cache instantly on task:updated", () => {
    const { queryClient, Wrapper } = createWrapper();
    const original = makeTask({ id: "TASK-001", status: "In Progress" });
    queryClient.setQueryData(["tasks", "repo-1"], [original]);

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    act(() => {
      sendMessage({
        type: "task:updated",
        data: { ...original, status: "Review" },
      });
    });

    const tasks = queryClient.getQueryData<Task[]>(["tasks", "repo-1"]);
    expect(tasks).toHaveLength(1);
    expect(tasks?.[0].status).toBe("Review");
  });

  it("does not affect other tasks when patching on task:updated", () => {
    const { queryClient, Wrapper } = createWrapper();
    const task1 = makeTask({ id: "TASK-001", status: "In Progress" });
    const task2 = makeTask({ id: "TASK-002", status: "Backlog" });
    queryClient.setQueryData(["tasks", "repo-1"], [task1, task2]);

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    act(() => {
      sendMessage({
        type: "task:updated",
        data: { ...task1, status: "Review" },
      });
    });

    const tasks = queryClient.getQueryData<Task[]>(["tasks", "repo-1"]);
    expect(tasks?.[0].status).toBe("Review");
    expect(tasks?.[1].status).toBe("Backlog");
  });

  it("does not crash when task:updated task is not in the cache", () => {
    const { queryClient, Wrapper } = createWrapper();
    queryClient.setQueryData(
      ["tasks", "repo-1"],
      [makeTask({ id: "TASK-001" })],
    );

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    expect(() => {
      act(() => {
        sendMessage({
          type: "task:updated",
          data: makeTask({ id: "TASK-999", status: "Review" }),
        });
      });
    }).not.toThrow();

    // Unrelated task is untouched
    const tasks = queryClient.getQueryData<Task[]>(["tasks", "repo-1"]);
    expect(tasks?.[0].id).toBe("TASK-001");
  });

  it("does not crash when task:updated fires and cache is empty", () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    expect(() => {
      act(() => {
        sendMessage({ type: "task:updated", data: makeTask() });
      });
    }).not.toThrow();
  });

  it("applies rapid successive updates to the same task (last write wins)", () => {
    const { queryClient, Wrapper } = createWrapper();
    const original = makeTask({ id: "TASK-001", status: "Not Started" });
    queryClient.setQueryData(["tasks", "repo-1"], [original]);

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    act(() => {
      sendMessage({
        type: "task:updated",
        data: { ...original, status: "In Progress" },
      });
      sendMessage({
        type: "task:updated",
        data: { ...original, status: "Review" },
      });
      sendMessage({
        type: "task:updated",
        data: { ...original, status: "Done" },
      });
    });

    const tasks = queryClient.getQueryData<Task[]>(["tasks", "repo-1"]);
    expect(tasks?.[0].status).toBe("Done");
  });

  it("does not cross-contaminate caches for different repos on task:updated", () => {
    const { queryClient, Wrapper } = createWrapper();
    const taskRepo1 = makeTask({
      id: "TASK-001",
      repoId: "repo-1",
      status: "Backlog",
    });
    const taskRepo2 = makeTask({
      id: "TASK-001",
      repoId: "repo-2",
      status: "Backlog",
    });
    queryClient.setQueryData(["tasks", "repo-1"], [taskRepo1]);
    queryClient.setQueryData(["tasks", "repo-2"], [taskRepo2]);

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    act(() => {
      sendMessage({
        type: "task:updated",
        data: { ...taskRepo1, status: "In Progress" },
      });
    });

    expect(
      queryClient.getQueryData<Task[]>(["tasks", "repo-1"])?.[0].status,
    ).toBe("In Progress");
    // repo-2 cache is unchanged
    expect(
      queryClient.getQueryData<Task[]>(["tasks", "repo-2"])?.[0].status,
    ).toBe("Backlog");
  });

  // ─── task:created ────────────────────────────────────────────────────────

  it("appends new task to the cache on task:created", () => {
    const { queryClient, Wrapper } = createWrapper();
    const existing = makeTask({ id: "TASK-001" });
    queryClient.setQueryData(["tasks", "repo-1"], [existing]);

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    const newTask = makeTask({ id: "TASK-002", title: "New Task" });

    act(() => {
      sendMessage({ type: "task:created", data: newTask });
    });

    const tasks = queryClient.getQueryData<Task[]>(["tasks", "repo-1"]);
    expect(tasks).toHaveLength(2);
    expect(tasks?.[1].id).toBe("TASK-002");
  });

  it("does not write to cache when task:created and cache is empty (undefined)", () => {
    // When cache is undefined there is no active list to append to — the next
    // real fetch will include the new task. We just verify no crash occurs.
    const { queryClient, Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    expect(() => {
      act(() => {
        sendMessage({ type: "task:created", data: makeTask() });
      });
    }).not.toThrow();

    // Cache remains undefined — not populated with a partial list
    expect(
      queryClient.getQueryData<Task[]>(["tasks", "repo-1"]),
    ).toBeUndefined();
  });

  // ─── task:deleted ────────────────────────────────────────────────────────

  it("removes the task from the cache on task:deleted with repoId", () => {
    const { queryClient, Wrapper } = createWrapper();
    const task1 = makeTask({ id: "TASK-001" });
    const task2 = makeTask({ id: "TASK-002" });
    queryClient.setQueryData(["tasks", "repo-1"], [task1, task2]);

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    act(() => {
      sendMessage({
        type: "task:deleted",
        data: { id: "TASK-001", repoId: "repo-1" },
      });
    });

    const tasks = queryClient.getQueryData<Task[]>(["tasks", "repo-1"]);
    expect(tasks).toHaveLength(1);
    expect(tasks?.[0].id).toBe("TASK-002");
  });

  it("invalidates all tasks on task:deleted without repoId", () => {
    const { queryClient, Wrapper } = createWrapper();
    queryClient.setQueryData(["tasks", "repo-1"], [makeTask()]);

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    act(() => {
      sendMessage({ type: "task:deleted", data: { id: "TASK-001" } });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] });
  });

  it("does not crash when task:deleted task is not in cache", () => {
    const { queryClient, Wrapper } = createWrapper();
    queryClient.setQueryData(
      ["tasks", "repo-1"],
      [makeTask({ id: "TASK-001" })],
    );

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    expect(() => {
      act(() => {
        sendMessage({
          type: "task:deleted",
          data: { id: "TASK-999", repoId: "repo-1" },
        });
      });
    }).not.toThrow();

    const tasks = queryClient.getQueryData<Task[]>(["tasks", "repo-1"]);
    expect(tasks).toHaveLength(1);
  });

  // ─── repo events ────────────────────────────────────────────────────────

  it("invalidates repos on repo:created", () => {
    const { queryClient, Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    act(() => {
      sendMessage({ type: "repo:created", data: {} });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["repos"] });
  });

  it("invalidates repos on repo:deleted", () => {
    const { queryClient, Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    act(() => {
      sendMessage({ type: "repo:deleted", data: {} });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["repos"] });
  });

  // ─── malformed / unknown messages ───────────────────────────────────────

  it("ignores non-JSON messages without throwing", () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    expect(() => {
      act(() => {
        MockWebSocket.lastInstance.onmessage?.({
          data: "not json at all",
        } as MessageEvent);
      });
    }).not.toThrow();
  });

  it("silently ignores unknown message types without crashing or mutating cache", () => {
    const { queryClient, Wrapper } = createWrapper();
    const task = makeTask();
    queryClient.setQueryData(["tasks", "repo-1"], [task]);

    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    expect(() => {
      act(() => {
        sendMessage({ type: "some:unknown:event", data: { id: "TASK-001" } });
        sendMessage({ type: "terminal:output", data: "hello" });
        sendMessage({ type: "", data: null });
      });
    }).not.toThrow();

    // Cache is untouched
    expect(queryClient.getQueryData<Task[]>(["tasks", "repo-1"])).toHaveLength(
      1,
    );
  });

  // ─── onerror ────────────────────────────────────────────────────────────

  it("calls close() on onerror to hand off to onclose for reconnect", () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });
    const ws = MockWebSocket.lastInstance;

    act(() => {
      ws.onerror?.({} as Event);
    });

    expect(ws.close).toHaveBeenCalled();
  });

  // ─── reconnect ──────────────────────────────────────────────────────────

  it("schedules a new connection after unexpected close with initial 1s delay", () => {
    jest.useFakeTimers();
    const { Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });
    const first = MockWebSocket.lastInstance;

    // Simulate server-initiated close
    act(() => {
      first.onclose?.({} as CloseEvent);
    });

    // No reconnect yet — inside the backoff window
    expect(MockWebSocket.instanceCount).toBe(1);

    // Advance past the first backoff delay
    act(() => {
      jest.advanceTimersByTime(1100);
    });

    expect(MockWebSocket.instanceCount).toBe(2);
    expect(MockWebSocket.lastInstance).not.toBe(first);
    jest.useRealTimers();
  });

  it("doubles the delay on repeated failures (exponential backoff)", () => {
    jest.useFakeTimers();
    const { Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    // Failure 1 → 1s delay
    act(() => {
      MockWebSocket.lastInstance.onclose?.({} as CloseEvent);
    });
    act(() => {
      jest.advanceTimersByTime(1100);
    });
    const second = MockWebSocket.lastInstance;
    expect(MockWebSocket.instanceCount).toBe(2);

    // Failure 2 → 2s delay
    act(() => {
      second.onclose?.({} as CloseEvent);
    });
    // Only 1.5s elapsed — should not have reconnected yet
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(MockWebSocket.instanceCount).toBe(2);

    // Advance the remaining 500ms to surpass the 2s window
    act(() => {
      jest.advanceTimersByTime(600);
    });
    expect(MockWebSocket.instanceCount).toBe(3);

    jest.useRealTimers();
  });

  it("caps the reconnect delay at 30s", () => {
    jest.useFakeTimers();
    const { Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    // Simulate 10 consecutive failures to overflow the 30s cap
    // Delays: 1, 2, 4, 8, 16, 30, 30, ... (capped)
    for (let i = 0; i < 6; i++) {
      act(() => {
        MockWebSocket.lastInstance.onclose?.({} as CloseEvent);
      });
      act(() => {
        jest.advanceTimersByTime(35_000); // well past any delay
      });
    }

    const beforeCount = MockWebSocket.instanceCount;

    // After capping, one more failure should reconnect within 30s (not longer)
    act(() => {
      MockWebSocket.lastInstance.onclose?.({} as CloseEvent);
    });
    act(() => {
      jest.advanceTimersByTime(30_500);
    });

    expect(MockWebSocket.instanceCount).toBe(beforeCount + 1);

    jest.useRealTimers();
  });

  it("resets backoff attempt counter on successful connection (onopen)", () => {
    jest.useFakeTimers();
    const { Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    // Fail twice to get to a 2s backoff
    act(() => {
      MockWebSocket.lastInstance.onclose?.({} as CloseEvent);
    });
    act(() => {
      jest.advanceTimersByTime(1100);
    });
    act(() => {
      MockWebSocket.lastInstance.onclose?.({} as CloseEvent);
    });
    act(() => {
      jest.advanceTimersByTime(2100);
    });

    // Simulate successful reconnect
    act(() => {
      MockWebSocket.lastInstance.onopen?.({} as Event);
    });

    // After reset, the next failure should use 1s delay again
    act(() => {
      MockWebSocket.lastInstance.onclose?.({} as CloseEvent);
    });
    const countBeforeAdvance = MockWebSocket.instanceCount;

    // 1.1s should be enough for the reset 1s backoff, but not 2s
    act(() => {
      jest.advanceTimersByTime(1100);
    });

    expect(MockWebSocket.instanceCount).toBe(countBeforeAdvance + 1);

    jest.useRealTimers();
  });

  it("does not reconnect when the socket is closed intentionally on unmount", () => {
    jest.useFakeTimers();
    const { Wrapper } = createWrapper();
    const { unmount } = renderHook(() => useTasksSocket(), {
      wrapper: Wrapper,
    });
    const first = MockWebSocket.lastInstance;

    unmount();

    // Advance well past any backoff window
    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    // Still only the original socket — no reconnect
    expect(MockWebSocket.instanceCount).toBe(1);
    expect(MockWebSocket.lastInstance).toBe(first);

    jest.useRealTimers();
  });

  it("cancels a pending reconnect timer when unmounting during backoff", () => {
    jest.useFakeTimers();
    const { Wrapper } = createWrapper();
    const { unmount } = renderHook(() => useTasksSocket(), {
      wrapper: Wrapper,
    });

    // Trigger a disconnect to schedule a reconnect timer
    act(() => {
      MockWebSocket.lastInstance.onclose?.({} as CloseEvent);
    });

    // Unmount while the reconnect timer is pending
    unmount();

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    // Only the original socket — the timer was cancelled
    expect(MockWebSocket.instanceCount).toBe(1);

    jest.useRealTimers();
  });

  it("invalidates tasks query on successful reconnect (onopen)", () => {
    jest.useFakeTimers();
    const { queryClient, Wrapper } = createWrapper();
    renderHook(() => useTasksSocket(), { wrapper: Wrapper });

    // Disconnect and reconnect
    act(() => {
      MockWebSocket.lastInstance.onclose?.({} as CloseEvent);
    });
    act(() => {
      jest.advanceTimersByTime(1100);
    });

    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    act(() => {
      MockWebSocket.lastInstance.onopen?.({} as Event);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] });

    jest.useRealTimers();
  });
});
