import React from "react";
import { renderHook, act } from "@testing-library/react";

import { toast } from "@/components/Toast";
import type { Task } from "@/utils/tasks.types";
import { NotificationProvider, useNotifications } from "./NotificationContext";

jest.mock("@/components/Toast", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  },
}));

const mockToast = toast as unknown as {
  success: jest.Mock;
  error: jest.Mock;
  warning: jest.Mock;
  info: jest.Mock;
};

function makeWrapper() {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(NotificationProvider, null, children);
  }
  return Wrapper;
}

const baseTask: Task = {
  id: "task-1",
  title: "Test Task",
  status: "In Progress",
  spec: "",
  repo: "repo-1",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useNotifications", () => {
  it("throws when used outside NotificationProvider", () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    expect(() => renderHook(() => useNotifications())).toThrow(
      "useNotifications must be used within a NotificationProvider",
    );
    consoleError.mockRestore();
  });

  it("returns notifyTransition without throwing inside provider", () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    expect(typeof result.current.notifyTransition).toBe("function");
  });

  it("notifyTransition is stable across renders", () => {
    const { result, rerender } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    const first = result.current.notifyTransition;
    rerender();
    expect(result.current.notifyTransition).toBe(first);
  });
});

describe("notifyTransition - success toasts", () => {
  it('fires toast.success for "In Progress" -> "Review"', () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, status: "In Progress" },
        "In Progress",
        "Review",
      );
    });
    expect(mockToast.success).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledWith(
      '"Test Task" is ready for review',
    );
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('fires toast.success for "Review" -> "Done"', () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, status: "Review" },
        "Review",
        "Done",
      );
    });
    expect(mockToast.success).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledWith('"Test Task" is complete');
    expect(mockToast.info).not.toHaveBeenCalled();
  });
});

describe("notifyTransition - info toasts", () => {
  it('fires toast.info for "Not Started" -> "In Progress"', () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, status: "Not Started" },
        "Not Started",
        "In Progress",
      );
    });
    expect(mockToast.info).toHaveBeenCalledTimes(1);
    expect(mockToast.info).toHaveBeenCalledWith('Agent started "Test Task"');
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('fires toast.info for "Backlog" -> "In Progress"', () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, status: "Backlog" },
        "Backlog",
        "In Progress",
      );
    });
    expect(mockToast.info).toHaveBeenCalledTimes(1);
    expect(mockToast.info).toHaveBeenCalledWith('Agent started "Test Task"');
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});

describe("notifyTransition - ignored transitions", () => {
  it('does not fire any toast for "Backlog" -> "Not Started"', () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, status: "Backlog" },
        "Backlog",
        "Not Started",
      );
    });
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.info).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockToast.warning).not.toHaveBeenCalled();
  });

  it('does not fire any toast for "Not Started" -> "Backlog"', () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, status: "Not Started" },
        "Not Started",
        "Backlog",
      );
    });
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('does not fire any toast for "Done" -> "Backlog"', () => {
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, status: "Done" },
        "Done",
        "Backlog",
      );
    });
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.info).not.toHaveBeenCalled();
  });
});

describe("notifyTransition - title truncation", () => {
  it("truncates title longer than 40 characters with ellipsis", () => {
    const longTitle =
      "This is a very long task title that exceeds forty characters";
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, title: longTitle },
        "In Progress",
        "Review",
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      '"This is a very long task title that exce..." is ready for review',
    );
  });

  it("does not truncate title of exactly 40 characters", () => {
    const exactTitle = "Exactly forty characters in this title!!";
    expect(exactTitle.length).toBe(40);
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, title: exactTitle },
        "In Progress",
        "Review",
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      `"${exactTitle}" is ready for review`,
    );
  });

  it("does not truncate title shorter than 40 characters", () => {
    const shortTitle = "Short title";
    const { result } = renderHook(() => useNotifications(), {
      wrapper: makeWrapper(),
    });
    act(() => {
      result.current.notifyTransition(
        { ...baseTask, title: shortTitle },
        "Review",
        "Done",
      );
    });
    expect(mockToast.success).toHaveBeenCalledWith(
      `"${shortTitle}" is complete`,
    );
  });
});
