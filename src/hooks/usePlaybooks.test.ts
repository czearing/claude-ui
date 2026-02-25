// src/hooks/usePlaybooks.test.ts
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { usePlaybook, usePlaybooks } from "./usePlaybooks";

jest.mock("@/utils/playbooks.client", () => ({
  fetchPlaybooks: jest.fn(),
  fetchPlaybook: jest.fn(),
  createPlaybook: jest.fn(),
  updatePlaybook: jest.fn(),
  deletePlaybook: jest.fn(),
}));

import { fetchPlaybook, fetchPlaybooks } from "@/utils/playbooks.client";

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

describe("usePlaybooks", () => {
  it("returns the list of playbooks from the API", async () => {
    (fetchPlaybooks as jest.Mock).mockResolvedValue([{ name: "bugfix" }]);
    const { result } = renderHook(() => usePlaybooks(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ name: "bugfix" }]);
  });
});

describe("usePlaybook", () => {
  it("fetches a single playbook by name", async () => {
    (fetchPlaybook as jest.Mock).mockResolvedValue({
      name: "bugfix",
      content: "# Bugfix",
    });
    const { result } = renderHook(() => usePlaybook("bugfix"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      name: "bugfix",
      content: "# Bugfix",
    });
  });

  it("does not fetch when name is null", () => {
    const { result } = renderHook(() => usePlaybook(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchPlaybook).not.toHaveBeenCalled();
  });
});
