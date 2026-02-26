// src/hooks/useSkills.test.ts
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
  createSkill,
  deleteSkill,
  fetchSkill,
  fetchSkills,
  updateSkill,
} from "@/utils/skills.client";
import {
  useCreateSkill,
  useDeleteSkill,
  useSkill,
  useSkills,
  useUpdateSkill,
} from "./useSkills";

jest.mock("@/utils/skills.client", () => ({
  fetchSkills: jest.fn(),
  fetchSkill: jest.fn(),
  createSkill: jest.fn(),
  updateSkill: jest.fn(),
  deleteSkill: jest.fn(),
}));

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

describe("useSkills", () => {
  it("returns the list of skills from the API", async () => {
    (fetchSkills as jest.Mock).mockResolvedValue([
      { name: "bugfix", description: "Fix bugs" },
    ]);
    const { result } = renderHook(() => useSkills(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { name: "bugfix", description: "Fix bugs" },
    ]);
  });

  it("surfaces an error when fetch fails", async () => {
    (fetchSkills as jest.Mock).mockRejectedValue(new Error("Network error"));
    const { result } = renderHook(() => useSkills(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useSkill", () => {
  it("fetches a single skill by name", async () => {
    (fetchSkill as jest.Mock).mockResolvedValue({
      name: "bugfix",
      description: "Fix bugs",
      content: "# Bugfix",
    });
    const { result } = renderHook(() => useSkill("bugfix"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      name: "bugfix",
      description: "Fix bugs",
      content: "# Bugfix",
    });
  });

  it("does not fetch when name is null", () => {
    const { result } = renderHook(() => useSkill(null), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchSkill).not.toHaveBeenCalled();
  });

  it("surfaces an error when fetch fails", async () => {
    (fetchSkill as jest.Mock).mockRejectedValue(
      new Error("Failed to fetch skill"),
    );
    const { result } = renderHook(() => useSkill("bugfix"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useCreateSkill", () => {
  it("calls createSkill with name, description, content", async () => {
    const mockSkill = {
      name: "new-skill",
      description: "A new skill",
      content: "# New",
    };
    (createSkill as jest.Mock).mockResolvedValue(mockSkill);
    const { wrapper: Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateSkill(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        name: "new-skill",
        description: "A new skill",
        content: "# New",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(createSkill).toHaveBeenCalledWith(
      "new-skill",
      "A new skill",
      "# New",
      "global",
      undefined,
    );
  });

  it("invalidates the skills list on success", async () => {
    const mockSkill = {
      name: "new-skill",
      description: "A new skill",
      content: "# New",
    };
    (createSkill as jest.Mock).mockResolvedValue(mockSkill);
    const { wrapper: Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateSkill(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        name: "new-skill",
        description: "A new skill",
        content: "# New",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["skills", "global", ""] }),
    );
  });
});

describe("useUpdateSkill", () => {
  it("calls updateSkill and updates the individual skill cache", async () => {
    const updated = {
      name: "bugfix",
      description: "Updated description",
      content: "# Updated",
    };
    (updateSkill as jest.Mock).mockResolvedValue(updated);
    const { wrapper: Wrapper, queryClient } = makeWrapper();

    const { result } = renderHook(() => useUpdateSkill(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate({
        name: "bugfix",
        description: "Updated description",
        content: "# Updated",
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(updateSkill).toHaveBeenCalledWith(
      "bugfix",
      "Updated description",
      "# Updated",
      "global",
      undefined,
    );
    // onSuccess sets the individual skill cache entry
    expect(
      queryClient.getQueryData(["skills", "global", "", "bugfix"]),
    ).toEqual(updated);
  });
});

describe("useDeleteSkill", () => {
  it("calls deleteSkill with the name", async () => {
    (deleteSkill as jest.Mock).mockResolvedValue(undefined);
    const { wrapper: Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDeleteSkill(), { wrapper: Wrapper });

    act(() => {
      result.current.mutate("bugfix");
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(deleteSkill).toHaveBeenCalledWith("bugfix", "global", undefined);
  });
});
