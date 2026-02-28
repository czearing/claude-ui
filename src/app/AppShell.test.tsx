// src/app/AppShell.test.tsx
import { act, render, screen } from "@testing-library/react";

import type { Task } from "@/utils/tasks.types";
import { AppShell } from "./AppShell";

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => Promise<unknown>, _opts?: unknown) => {
    // Return a simple stub for any dynamic import
    const name = String(loader).includes("ChatPanel")
      ? "chat-panel"
      : "spec-editor";
    return function DynamicStub(props: Record<string, unknown>) {
      return (
        <div
          data-testid={name}
          data-chat-task={
            props["task"] ? (props["task"] as Task).id : undefined
          }
        />
      );
    };
  },
}));

const mockUseTasks = jest.fn();
const mockCreateMutate = jest.fn();

jest.mock("@/hooks/useTasks", () => ({
  useTasks: (...args: unknown[]) => mockUseTasks(...args),
  useCreateTask: () => ({ mutate: mockCreateMutate }),
}));

jest.mock("@/hooks/useTasksSocket", () => ({
  useTasksSocket: jest.fn(),
}));

// Capture Board's callbacks so tests can trigger them
let capturedBoardOnSelect: ((t: Task) => void) | undefined;
let capturedBoardOnHandover: ((id: string) => void) | undefined;
let capturedBacklogOnSelect: ((t: Task) => void) | undefined;
let capturedBacklogOnNewTask: (() => void) | undefined;

jest.mock("@/components/Board/Board", () => ({
  Board: (props: {
    tasks: Task[];
    onSelectTask: (t: Task) => void;
    onHandover?: (id: string) => void;
  }) => {
    capturedBoardOnSelect = props.onSelectTask;
    capturedBoardOnHandover = props.onHandover;
    return <div data-testid="board" />;
  },
}));

jest.mock("@/components/Board/Backlog", () => ({
  Backlog: (props: {
    onSelectTask: (t: Task) => void;
    onNewTask: () => void;
  }) => {
    capturedBacklogOnSelect = props.onSelectTask;
    capturedBacklogOnNewTask = props.onNewTask;
    return <div data-testid="backlog" />;
  },
}));

jest.mock("@/components/Layout/Sidebar", () => ({
  Sidebar: (props: { agentActive?: boolean }) => (
    <div data-testid="sidebar" data-agent-active={String(props.agentActive)} />
  ),
}));

jest.mock("@/components/Layout/TopBar", () => ({
  TopBar: () => <div data-testid="topbar" />,
}));

const backlogTask: Task = {
  id: "t-1",
  title: "Fix bug",
  status: "Backlog",
  spec: "",
  repo: "repo-1",
};

beforeEach(() => {
  mockCreateMutate.mockClear();
  capturedBoardOnSelect = undefined;
  capturedBoardOnHandover = undefined;
  capturedBacklogOnSelect = undefined;
  capturedBacklogOnNewTask = undefined;
  mockUseTasks.mockReturnValue({ data: [backlogTask] });
  // Reset URL to base path so URL-restore tests start clean
  window.history.replaceState({}, "", "/");
});

describe("AppShell", () => {
  it("renders the Board when view is Board", () => {
    render(<AppShell repo="repo-1" view="Board" />);
    expect(screen.getByTestId("board")).toBeInTheDocument();
    expect(screen.queryByTestId("backlog")).not.toBeInTheDocument();
  });

  it("renders the Backlog when view is Tasks", () => {
    render(<AppShell repo="repo-1" view="Tasks" />);
    expect(screen.getByTestId("backlog")).toBeInTheDocument();
    expect(screen.queryByTestId("board")).not.toBeInTheDocument();
  });

  it("filters Backlog tasks out of the Board task list", () => {
    const reviewTask: Task = { ...backlogTask, id: "t-3", status: "Review" };
    mockUseTasks.mockReturnValue({ data: [backlogTask, reviewTask] });
    render(<AppShell repo="repo-1" view="Board" />);
    expect(screen.getByTestId("board")).toBeInTheDocument();
  });

  it("opens chat panel when a Board task is selected", () => {
    const sessionTask: Task = {
      ...backlogTask,
      id: "t-4",
      status: "In Progress",
      sessionId: "ses-abc",
    };
    mockUseTasks.mockReturnValue({ data: [sessionTask] });
    render(<AppShell repo="repo-1" view="Board" />);

    act(() => capturedBoardOnSelect?.(sessionTask));

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toHaveAttribute(
      "data-chat-task",
      "t-4",
    );
  });

  it("shows spec editor when a task is selected in Tasks view", () => {
    render(<AppShell repo="repo-1" view="Tasks" />);
    act(() => capturedBacklogOnSelect?.(backlogTask));
    expect(screen.getByTestId("spec-editor")).toBeInTheDocument();
  });

  it("opens chat panel immediately when handover is triggered", () => {
    mockUseTasks.mockReturnValue({ data: [backlogTask] });
    render(<AppShell repo="repo-1" view="Board" />);
    act(() => capturedBoardOnHandover?.("t-1"));

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toHaveAttribute(
      "data-chat-task",
      "t-1",
    );
  });

  it("opens chat panel for Review task selected on Board", () => {
    const reviewTask: Task = {
      ...backlogTask,
      id: "t-5",
      status: "Review",
      sessionId: "ses-review",
    };
    mockUseTasks.mockReturnValue({ data: [reviewTask] });
    render(<AppShell repo="repo-1" view="Board" />);

    act(() => capturedBoardOnSelect?.(reviewTask));

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toHaveAttribute(
      "data-chat-task",
      "t-5",
    );
  });

  it("closes spec editor when Escape is pressed", () => {
    render(<AppShell repo="repo-1" view="Tasks" />);
    act(() => capturedBacklogOnSelect?.(backlogTask));
    expect(screen.getByTestId("spec-editor")).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByTestId("spec-editor")).not.toBeInTheDocument();
  });

  it("opens spec editor when a new task is created successfully", () => {
    mockCreateMutate.mockImplementation(
      (_: unknown, opts?: { onSuccess?: (t: Task) => void }) => {
        opts?.onSuccess?.({ ...backlogTask, id: "t-new" });
      },
    );
    render(<AppShell repo="repo-1" view="Tasks" />);
    act(() => capturedBacklogOnNewTask?.());
    expect(screen.getByTestId("spec-editor")).toBeInTheDocument();
  });

  it("calls createTask with empty title on new task", () => {
    render(<AppShell repo="repo-1" view="Tasks" />);
    act(() => capturedBacklogOnNewTask?.());
    expect(mockCreateMutate).toHaveBeenCalledWith(
      { title: "", status: "Backlog" },
      expect.any(Object),
    );
  });

  it("does not open spec editor when createTask has no onSuccess callback fired", () => {
    mockCreateMutate.mockImplementation(() => {
      /* onSuccess not called */
    });
    render(<AppShell repo="repo-1" view="Tasks" />);
    act(() => capturedBacklogOnNewTask?.());
    expect(screen.queryByTestId("spec-editor")).not.toBeInTheDocument();
  });

  it("restores chat panel from URL chatTask param on mount", () => {
    const sessionTask: Task = {
      ...backlogTask,
      id: "t-url",
      status: "In Progress",
      sessionId: "ses-url",
    };
    mockUseTasks.mockReturnValue({ data: [sessionTask] });
    window.history.replaceState({}, "", "?chatTask=t-url");

    render(<AppShell repo="repo-1" view="Board" />);

    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(screen.getByTestId("chat-panel")).toHaveAttribute(
      "data-chat-task",
      "t-url",
    );
  });

  it("chat panel disappears after Escape is pressed", () => {
    const sessionTask: Task = {
      ...backlogTask,
      id: "t-4",
      status: "In Progress",
    };
    mockUseTasks.mockReturnValue({ data: [sessionTask] });
    render(<AppShell repo="repo-1" view="Board" />);
    act(() => capturedBoardOnSelect?.(sessionTask));
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByTestId("chat-panel")).not.toBeInTheDocument();
  });
});
