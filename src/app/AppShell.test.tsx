// src/app/AppShell.test.tsx
import { act, render, screen } from "@testing-library/react";

import type { Task } from "@/utils/tasks.types";
import { AppShell } from "./AppShell";

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => () => <div data-testid="spec-editor" />,
}));

const mockUseTasks = jest.fn();
const mockHandoverMutate = jest.fn();
const mockCreateMutate = jest.fn();

jest.mock("@/hooks/useTasks", () => ({
  useTasks: (...args: unknown[]) => mockUseTasks(...args),
  useHandoverTask: () => ({ mutate: mockHandoverMutate }),
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

jest.mock("@/components/Terminal/TerminalFlyout", () => ({
  TerminalFlyout: (props: {
    sessions: { sessionId: string }[];
    activeSessionId: string;
    onCloseTab: (id: string) => void;
    onClose: () => void;
  }) => (
    <div
      data-testid="terminal-flyout"
      data-active-session={props.activeSessionId}
    >
      {props.sessions.map((s) => (
        <button
          key={s.sessionId}
          data-testid={`close-tab-${s.sessionId}`}
          onClick={() => props.onCloseTab(s.sessionId)}
        >
          close tab
        </button>
      ))}
      <button onClick={props.onClose}>close all</button>
    </div>
  ),
}));

const backlogTask: Task = {
  id: "t-1",
  title: "Fix bug",
  status: "Backlog",
  spec: "",
  repo: "repo-1",
};

const inProgressTask: Task = {
  ...backlogTask,
  id: "t-2",
  status: "In Progress",
};

beforeEach(() => {
  mockHandoverMutate.mockClear();
  mockCreateMutate.mockClear();
  capturedBoardOnSelect = undefined;
  capturedBoardOnHandover = undefined;
  capturedBacklogOnSelect = undefined;
  capturedBacklogOnNewTask = undefined;
  mockUseTasks.mockReturnValue({ data: [backlogTask] });
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

  it("passes agentActive=false to Sidebar when no task is In Progress", () => {
    mockUseTasks.mockReturnValue({ data: [backlogTask] });
    render(<AppShell repo="repo-1" view="Board" />);
    expect(screen.getByTestId("sidebar")).toHaveAttribute(
      "data-agent-active",
      "false",
    );
  });

  it("passes agentActive=true to Sidebar when a task is In Progress", () => {
    mockUseTasks.mockReturnValue({ data: [inProgressTask] });
    render(<AppShell repo="repo-1" view="Board" />);
    expect(screen.getByTestId("sidebar")).toHaveAttribute(
      "data-agent-active",
      "true",
    );
  });

  it("filters Backlog tasks out of the Board task list", () => {
    const reviewTask: Task = { ...backlogTask, id: "t-3", status: "Review" };
    mockUseTasks.mockReturnValue({ data: [backlogTask, reviewTask] });
    render(<AppShell repo="repo-1" view="Board" />);
    expect(screen.getByTestId("board")).toBeInTheDocument();
  });

  it("opens terminal flyout when Board task with a sessionId is selected", () => {
    const sessionTask: Task = {
      ...backlogTask,
      id: "t-4",
      status: "In Progress",
      sessionId: "ses-abc",
    };
    mockUseTasks.mockReturnValue({ data: [sessionTask] });
    render(<AppShell repo="repo-1" view="Board" />);

    act(() => capturedBoardOnSelect?.(sessionTask));

    expect(screen.getByTestId("terminal-flyout")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-flyout")).toHaveAttribute(
      "data-active-session",
      "ses-abc",
    );
  });

  it("shows spec editor when a task is selected in Tasks view", () => {
    render(<AppShell repo="repo-1" view="Tasks" />);
    act(() => capturedBacklogOnSelect?.(backlogTask));
    expect(screen.getByTestId("spec-editor")).toBeInTheDocument();
  });

  it("opens terminal flyout after a successful handover from the Board", () => {
    const handoverResult: Task = {
      ...backlogTask,
      id: "t-4",
      status: "In Progress",
      sessionId: "ses-xyz",
    };
    mockHandoverMutate.mockImplementation(
      (_id: string, opts?: { onSuccess?: (t: Task) => void }) => {
        opts?.onSuccess?.(handoverResult);
      },
    );
    mockUseTasks.mockReturnValue({ data: [handoverResult] });
    render(<AppShell repo="repo-1" view="Board" />);
    act(() => capturedBoardOnHandover?.("t-1"));

    expect(screen.getByTestId("terminal-flyout")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-flyout")).toHaveAttribute(
      "data-active-session",
      "ses-xyz",
    );
  });

  it("opens flyout for Review task with sessionId selected on Board", () => {
    const reviewTask: Task = {
      ...backlogTask,
      id: "t-5",
      status: "Review",
      sessionId: "ses-review",
    };
    mockUseTasks.mockReturnValue({ data: [reviewTask] });
    render(<AppShell repo="repo-1" view="Board" />);

    act(() => capturedBoardOnSelect?.(reviewTask));

    expect(screen.getByTestId("terminal-flyout")).toBeInTheDocument();
    expect(screen.getByTestId("terminal-flyout")).toHaveAttribute(
      "data-active-session",
      "ses-review",
    );
  });

  it("closing a tab removes it; flyout hides when last tab closed", () => {
    const sessionTask: Task = {
      ...backlogTask,
      id: "t-4",
      status: "In Progress",
      sessionId: "ses-abc",
    };
    mockUseTasks.mockReturnValue({ data: [sessionTask] });
    render(<AppShell repo="repo-1" view="Board" />);

    act(() => capturedBoardOnSelect?.(sessionTask));
    expect(screen.getByTestId("terminal-flyout")).toBeInTheDocument();

    act(() => {
      screen.getByTestId("close-tab-ses-abc").click();
    });
    expect(screen.queryByTestId("terminal-flyout")).not.toBeInTheDocument();
  });

  it("switching tabs updates the active session", () => {
    const taskA: Task = {
      ...backlogTask,
      id: "t-a",
      status: "In Progress",
      sessionId: "ses-a",
    };
    const taskB: Task = {
      ...backlogTask,
      id: "t-b",
      status: "Review",
      sessionId: "ses-b",
    };
    mockUseTasks.mockReturnValue({ data: [taskA, taskB] });
    render(<AppShell repo="repo-1" view="Board" />);

    act(() => capturedBoardOnSelect?.(taskA));
    act(() => capturedBoardOnSelect?.(taskB));

    // Both tabs open; ses-b is active (last opened)
    expect(screen.getByTestId("terminal-flyout")).toHaveAttribute(
      "data-active-session",
      "ses-b",
    );
  });

  it("closes flyout tab automatically when a session's task loses its sessionId", () => {
    const sessionTask: Task = {
      ...backlogTask,
      id: "t-4",
      status: "In Progress",
      sessionId: "ses-abc",
    };
    mockUseTasks.mockReturnValue({ data: [sessionTask] });
    const { rerender } = render(<AppShell repo="repo-1" view="Board" />);

    act(() => capturedBoardOnSelect?.(sessionTask));
    expect(screen.getByTestId("terminal-flyout")).toBeInTheDocument();

    // Simulate task moving to Done (sessionId cleared by server broadcast)
    const doneTask: Task = {
      ...sessionTask,
      status: "Done",
      sessionId: undefined,
    };
    mockUseTasks.mockReturnValue({ data: [doneTask] });
    rerender(<AppShell repo="repo-1" view="Board" />);

    expect(screen.queryByTestId("terminal-flyout")).not.toBeInTheDocument();
  });

  it("switches active tab to neighbour when the active session is terminated", () => {
    const taskA: Task = {
      ...backlogTask,
      id: "t-a",
      status: "In Progress",
      sessionId: "ses-a",
    };
    const taskB: Task = {
      ...backlogTask,
      id: "t-b",
      status: "In Progress",
      sessionId: "ses-b",
    };
    mockUseTasks.mockReturnValue({ data: [taskA, taskB] });
    const { rerender } = render(<AppShell repo="repo-1" view="Board" />);

    act(() => capturedBoardOnSelect?.(taskA));
    act(() => capturedBoardOnSelect?.(taskB));

    // ses-b is active; terminate ses-b
    const doneB: Task = { ...taskB, status: "Done", sessionId: undefined };
    mockUseTasks.mockReturnValue({ data: [taskA, doneB] });
    rerender(<AppShell repo="repo-1" view="Board" />);

    // Falls back to ses-a
    expect(screen.getByTestId("terminal-flyout")).toHaveAttribute(
      "data-active-session",
      "ses-a",
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
});
