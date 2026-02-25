// src/components/Editor/SpecEditor/SpecEditor.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Task } from "@/utils/tasks.types";
import { SpecEditor } from "./SpecEditor";

const mockUpdateTask = jest.fn();
const mockUpdateTaskAsync = jest.fn().mockResolvedValue(undefined);
const mockHandoverTask = jest.fn();

jest.mock("@/hooks/useTasks", () => ({
  useUpdateTask: () => ({
    mutate: mockUpdateTask,
    mutateAsync: mockUpdateTaskAsync,
  }),
  useHandoverTask: () => ({
    mutate: mockHandoverTask,
    isPending: false,
  }),
}));

// Execute synchronously so save assertions work without fake timers.
// Debounce timing behavior is covered by useDebouncedCallback.test.ts.
jest.mock("@/hooks/useDebouncedCallback", () => ({
  useDebouncedCallback: (fn: (...args: unknown[]) => void) => [
    (...args: unknown[]) => fn(...args),
    jest.fn(),
  ],
}));

jest.mock("../LexicalEditor", () => ({
  LexicalEditor: ({
    onChange,
    placeholder,
  }: {
    onChange?: (v: string) => void;
    placeholder?: string;
  }) => (
    <div data-testid="lexical-editor">
      <button
        data-testid="editor-change-trigger"
        onClick={() => onChange?.("updated spec content")}
      >
        Change
      </button>
      {placeholder}
    </div>
  ),
}));

const backlogTask: Task = {
  id: "task-1",
  title: "Fix the bug",
  status: "Backlog",
  priority: "Medium",
  spec: "",
  repoId: "repo-1",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const inProgressTask: Task = {
  ...backlogTask,
  id: "task-2",
  status: "In Progress",
};

const reviewTask: Task = {
  ...backlogTask,
  id: "task-3",
  status: "Review",
  sessionId: "session-abc",
};

describe("SpecEditor", () => {
  beforeEach(() => {
    mockUpdateTask.mockClear();
    mockHandoverTask.mockClear();
    mockUpdateTaskAsync.mockClear();
  });

  it("renders nothing when task is null", () => {
    const { container } = render(
      <SpecEditor repoId="repo-1" task={null} onClose={jest.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a title input for Backlog tasks", () => {
    render(
      <SpecEditor repoId="repo-1" task={backlogTask} onClose={jest.fn()} />,
    );
    expect(screen.getByPlaceholderText("New Title")).toHaveValue("Fix the bug");
  });

  it("shows an h1 title for non-Backlog tasks", () => {
    render(
      <SpecEditor repoId="repo-1" task={inProgressTask} onClose={jest.fn()} />,
    );
    expect(
      screen.getByRole("heading", { name: "Fix the bug", level: 1 }),
    ).toBeInTheDocument();
  });

  it("shows the Handover to Claude button for Backlog tasks", () => {
    render(
      <SpecEditor repoId="repo-1" task={backlogTask} onClose={jest.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: /handover to claude/i }),
    ).toBeInTheDocument();
  });

  it("does not show the Handover button for non-Backlog tasks", () => {
    render(
      <SpecEditor repoId="repo-1" task={inProgressTask} onClose={jest.fn()} />,
    );
    expect(
      screen.queryByRole("button", { name: /handover to claude/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Agent Notes for Review tasks", () => {
    render(
      <SpecEditor repoId="repo-1" task={reviewTask} onClose={jest.fn()} />,
    );
    expect(screen.getByText("Agent Notes")).toBeInTheDocument();
  });

  it("shows an Open Terminal link for Review tasks with a sessionId", () => {
    render(
      <SpecEditor repoId="repo-1" task={reviewTask} onClose={jest.fn()} />,
    );
    expect(
      screen.getByRole("link", { name: /open terminal/i }),
    ).toBeInTheDocument();
  });

  it("does not show Agent Notes for Backlog tasks", () => {
    render(
      <SpecEditor repoId="repo-1" task={backlogTask} onClose={jest.fn()} />,
    );
    expect(screen.queryByText("Agent Notes")).not.toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", async () => {
    const onClose = jest.fn();
    render(<SpecEditor repoId="repo-1" task={backlogTask} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders the Lexical editor", () => {
    render(
      <SpecEditor repoId="repo-1" task={backlogTask} onClose={jest.fn()} />,
    );
    expect(screen.getByTestId("lexical-editor")).toBeInTheDocument();
  });

  // ── Save behaviour ────────────────────────────────────────────────────────

  it("saves spec when content changes", async () => {
    render(
      <SpecEditor repoId="repo-1" task={backlogTask} onClose={jest.fn()} />,
    );
    await userEvent.click(screen.getByTestId("editor-change-trigger"));
    expect(mockUpdateTask).toHaveBeenCalledWith({
      id: "task-1",
      spec: "updated spec content",
    });
  });

  it("does not save spec when content matches the already-saved value", async () => {
    const taskWithSpec = { ...backlogTask, spec: "updated spec content" };
    render(
      <SpecEditor repoId="repo-1" task={taskWithSpec} onClose={jest.fn()} />,
    );
    await userEvent.click(screen.getByTestId("editor-change-trigger"));
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it("saves title when the title input changes", async () => {
    render(
      <SpecEditor repoId="repo-1" task={backlogTask} onClose={jest.fn()} />,
    );
    const input = screen.getByPlaceholderText("New Title");
    await userEvent.clear(input);
    await userEvent.type(input, "Updated title");
    expect(mockUpdateTask).toHaveBeenLastCalledWith({
      id: "task-1",
      title: "Updated title",
    });
  });

  it("does not save title when the input is cleared to empty", async () => {
    render(
      <SpecEditor repoId="repo-1" task={backlogTask} onClose={jest.fn()} />,
    );
    const input = screen.getByPlaceholderText("New Title");
    await userEvent.clear(input);
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it("handover flushes latest spec via updateTaskAsync before handing off", async () => {
    render(
      <SpecEditor repoId="repo-1" task={backlogTask} onClose={jest.fn()} />,
    );
    await userEvent.click(screen.getByTestId("editor-change-trigger"));
    mockUpdateTask.mockClear();

    await userEvent.click(
      screen.getByRole("button", { name: /handover to claude/i }),
    );

    expect(mockUpdateTaskAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-1", spec: "updated spec content" }),
    );
    expect(mockHandoverTask).toHaveBeenCalledWith("task-1", expect.any(Object));
  });
});
