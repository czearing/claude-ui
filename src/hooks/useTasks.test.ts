// src/hooks/useTasks.test.ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import {
  useCreateTask,
  useDeleteTask,
  useTasks,
  useUpdateTask,
} from "./useTasks";
import type { Task } from "@/utils/tasks.types";

const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => jest.clearAllMocks());

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  }
  return { wrapper: Wrapper, queryClient };
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

const REPO_ID = "repo-1";

const mockTask: Task = {
  id: "task-1",
  title: "Test Task",
  status: "Not Started",
  priority: "Medium",
  spec: "",
  repoId: REPO_ID,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("useTasks", () => {
  it("fetches tasks for a repoId", async () => {
    mockFetch.mockResolvedValue(okJson([mockTask]));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTasks(REPO_ID), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([mockTask]);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/tasks?repoId=${encodeURIComponent(REPO_ID)}`,
    );
  });

  it("does not fetch when repoId is empty", () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTasks(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces an error when the fetch fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTasks(REPO_ID), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCreateTask", () => {
  it("POSTs to /api/tasks with repoId merged in", async () => {
    mockFetch.mockResolvedValue(okJson(mockTask));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateTask(REPO_ID), { wrapper });

    result.current.mutate({ title: "Test Task" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/tasks");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toMatchObject({
      title: "Test Task",
      repoId: REPO_ID,
    });
  });
});

describe("useUpdateTask", () => {
  it("optimistically updates the task in the cache before the request resolves", async () => {
    const { wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["tasks", REPO_ID], [mockTask]);

    let resolveFetch!: (v: unknown) => void;
    const pendingFetch = new Promise((res) => {
      resolveFetch = res;
    });
    mockFetch.mockReturnValue(pendingFetch);

    const { result } = renderHook(() => useUpdateTask(REPO_ID), { wrapper });

    act(() => {
      result.current.mutate({ id: "task-1", title: "Updated" });
    });

    // Before the fetch resolves, the cache should already reflect the change
    await waitFor(() => {
      const cached = queryClient.getQueryData<Task[]>(["tasks", REPO_ID]);
      return cached?.[0]?.title === "Updated";
    });

    resolveFetch({
      ok: true,
      json: () => Promise.resolve({ ...mockTask, title: "Updated" }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back the optimistic update when the request fails", async () => {
    const { wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["tasks", REPO_ID], [mockTask]);

    // Cause the mutation to fail by making r.json() reject
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error("Server error")),
    });

    const { result } = renderHook(() => useUpdateTask(REPO_ID), { wrapper });

    act(() => {
      result.current.mutate({ id: "task-1", title: "Bad Update" });
    });

    // Wait for the rollback — cache should revert to the original title
    await waitFor(() => {
      const cached = queryClient.getQueryData<Task[]>(["tasks", REPO_ID]);
      return cached?.[0]?.title === "Test Task";
    });

    expect(result.current.isError).toBe(true);
  });
});

describe("useDeleteTask", () => {
  it("optimistically removes the task from the cache before the request resolves", async () => {
    const { wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["tasks", REPO_ID], [mockTask]);

    let resolveFetch!: (v: unknown) => void;
    const pendingFetch = new Promise((res) => {
      resolveFetch = res;
    });
    mockFetch.mockReturnValue(pendingFetch);

    const { result } = renderHook(() => useDeleteTask(REPO_ID), { wrapper });

    act(() => {
      result.current.mutate("task-1");
    });

    // Before the fetch resolves, the task should already be gone from cache
    await waitFor(() => {
      const cached = queryClient.getQueryData<Task[]>(["tasks", REPO_ID]);
      return cached?.length === 0;
    });

    resolveFetch({ ok: true, status: 200 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls back the optimistic delete when the request fails", async () => {
    const { wrapper, queryClient } = makeWrapper();
    queryClient.setQueryData(["tasks", REPO_ID], [mockTask]);

    // Network-level rejection triggers onError (mutationFn does not check r.ok)
    mockFetch.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useDeleteTask(REPO_ID), { wrapper });

    act(() => {
      result.current.mutate("task-1");
    });

    // Wait for the rollback — original task should be restored
    await waitFor(() => {
      const cached = queryClient.getQueryData<Task[]>(["tasks", REPO_ID]);
      return cached?.length === 1;
    });

    expect(queryClient.getQueryData<Task[]>(["tasks", REPO_ID])).toEqual([
      mockTask,
    ]);
    expect(result.current.isError).toBe(true);
  });
});
