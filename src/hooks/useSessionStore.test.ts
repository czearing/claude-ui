import { renderHook, act, waitFor } from "@testing-library/react";

import { useSessionStore } from "./useSessionStore";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

global.fetch = jest.fn().mockResolvedValue({ ok: true });

describe("useSessionStore", () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it("deleteSession calls DELETE /api/sessions/:id", async () => {
    const { result } = renderHook(() => useSessionStore());

    let session: ReturnType<typeof result.current.addSession>;
    act(() => {
      session = result.current.addSession();
    });

    await act(async () => {
      await result.current.deleteSession(session!.id);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/sessions/${session!.id}`,
      { method: "DELETE" }
    );
  });

  it("deleteSession removes session from state", async () => {
    const { result } = renderHook(() => useSessionStore());

    let session: ReturnType<typeof result.current.addSession>;
    act(() => {
      session = result.current.addSession();
    });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteSession(session!.id);
    });

    expect(result.current.sessions).toHaveLength(0);
  });

  it("deleteSession removes session even if fetch throws", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));
    const { result } = renderHook(() => useSessionStore());

    let session: ReturnType<typeof result.current.addSession>;
    act(() => {
      session = result.current.addSession();
    });

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    await act(async () => {
      await result.current.deleteSession(session!.id);
    });

    expect(result.current.sessions).toHaveLength(0);
  });
});
