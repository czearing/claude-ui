// src/hooks/useRepos.test.ts
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { useCreateRepo, useDeleteRepo, useRepos } from "./useRepos";
import type { Repo } from "@/utils/tasks.types";

const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => jest.clearAllMocks());

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children,
  );
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

const mockRepo: Repo = {
  id: "repo-1",
  name: "My Repo",
  path: "/home/user/my-repo",
  createdAt: "2024-01-01T00:00:00.000Z",
};

describe("useRepos", () => {
  it("fetches repos from /api/repos", async () => {
    mockFetch.mockResolvedValue(okJson([mockRepo]));
    const { result } = renderHook(() => useRepos(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([mockRepo]);
    expect(mockFetch).toHaveBeenCalledWith("/api/repos");
  });

  it("surfaces an error when the fetch fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const { result } = renderHook(() => useRepos(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useCreateRepo", () => {
  it("POSTs to /api/repos with the correct body", async () => {
    mockFetch.mockResolvedValue(okJson(mockRepo));
    const { result } = renderHook(() => useCreateRepo(), { wrapper });

    result.current.mutate({ name: "My Repo", path: "/home/user/my-repo" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockRepo);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/repos");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      name: "My Repo",
      path: "/home/user/my-repo",
    });
  });

  it("surfaces the server error message on failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "Path already registered" }),
    });
    const { result } = renderHook(() => useCreateRepo(), { wrapper });
    result.current.mutate({ name: "x", path: "/x" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe(
      "Path already registered",
    );
  });
});

describe("useDeleteRepo", () => {
  it("sends DELETE to /api/repos/:id", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const { result } = renderHook(() => useDeleteRepo(), { wrapper });
    result.current.mutate("repo-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith("/api/repos/repo-1", {
      method: "DELETE",
    });
  });
});
