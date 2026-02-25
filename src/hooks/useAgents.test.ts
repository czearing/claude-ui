// src/hooks/useAgents.test.ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import {
  useAgents,
  useAgent,
  useCreateAgent,
  useUpdateAgent,
  useDeleteAgent,
} from "./useAgents";

jest.mock("@/utils/agents.client", () => ({
  fetchAgents: jest.fn(),
  fetchAgent: jest.fn(),
  createAgent: jest.fn(),
  updateAgent: jest.fn(),
  deleteAgent: jest.fn(),
}));

import {
  createAgent,
  deleteAgent,
  fetchAgent,
  fetchAgents,
  updateAgent,
} from "@/utils/agents.client";

afterEach(() => jest.clearAllMocks());

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children,
  );
}

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

describe("useAgents", () => {
  it("returns the list of agents from the API", async () => {
    (fetchAgents as jest.Mock).mockResolvedValue([
      { name: "code-reviewer", description: "Reviews code" },
    ]);
    const { result } = renderHook(() => useAgents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { name: "code-reviewer", description: "Reviews code" },
    ]);
  });

  it("surfaces an error when fetch fails", async () => {
    (fetchAgents as jest.Mock).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useAgents(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useAgent", () => {
  it("fetches a single agent by name", async () => {
    (fetchAgent as jest.Mock).mockResolvedValue({
      name: "code-reviewer",
      description: "Reviews code",
      content: "# Reviewer",
    });
    const { result } = renderHook(() => useAgent("code-reviewer"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      name: "code-reviewer",
      description: "Reviews code",
      content: "# Reviewer",
    });
  });

  it("does not fetch when name is null", () => {
    const { result } = renderHook(() => useAgent(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchAgent).not.toHaveBeenCalled();
  });

  it("surfaces an error when fetch fails", async () => {
    (fetchAgent as jest.Mock).mockRejectedValue(
      new Error("Failed to fetch agent"),
    );
    const { result } = renderHook(() => useAgent("code-reviewer"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCreateAgent", () => {
  it("calls createAgent with name, description, content", async () => {
    const mockAgent = {
      name: "new-agent",
      description: "A new agent",
      content: "# New",
    };
    (createAgent as jest.Mock).mockResolvedValue(mockAgent);
    const { wrapper: Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        name: "new-agent",
        description: "A new agent",
        content: "# New",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createAgent).toHaveBeenCalledWith(
      "new-agent",
      "A new agent",
      "# New",
      "global",
      undefined,
    );
  });

  it("invalidates the agents list on success", async () => {
    const mockAgent = {
      name: "new-agent",
      description: "A new agent",
      content: "# New",
    };
    (createAgent as jest.Mock).mockResolvedValue(mockAgent);
    const { wrapper: Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateAgent(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        name: "new-agent",
        description: "A new agent",
        content: "# New",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["agents", "global", ""] }),
    );
  });
});

describe("useUpdateAgent", () => {
  it("calls updateAgent and updates the individual agent cache", async () => {
    const updated = {
      name: "code-reviewer",
      description: "Updated description",
      content: "# Updated",
    };
    (updateAgent as jest.Mock).mockResolvedValue(updated);
    const { wrapper: Wrapper, queryClient } = makeWrapper();

    const { result } = renderHook(() => useUpdateAgent(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        name: "code-reviewer",
        description: "Updated description",
        content: "# Updated",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateAgent).toHaveBeenCalledWith(
      "code-reviewer",
      "Updated description",
      "# Updated",
      "global",
      undefined,
    );
    expect(
      queryClient.getQueryData(["agents", "global", "", "code-reviewer"]),
    ).toEqual(updated);
  });
});

describe("useDeleteAgent", () => {
  it("calls deleteAgent with the name", async () => {
    (deleteAgent as jest.Mock).mockResolvedValue(undefined);
    const { wrapper: Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteAgent(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate("code-reviewer");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteAgent).toHaveBeenCalledWith(
      "code-reviewer",
      "global",
      undefined,
    );
  });
});
