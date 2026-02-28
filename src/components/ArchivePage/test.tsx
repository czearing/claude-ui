import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ArchivePage } from "./ArchivePage";

const mockUpdateTask = jest.fn();
const mockDeleteTask = jest.fn();
const mockUseTasks = jest.fn().mockReturnValue({
  data: [
    {
      id: "TASK-001",
      title: "Finished feature",
      status: "Done",
      spec: "",
      repo: "repo-1",
      archivedAt: "2026-02-25T10:00:00.000Z",
    },
    {
      id: "TASK-002",
      title: "In progress task",
      status: "In Progress",
      spec: "",
      repo: "repo-1",
    },
  ],
});

jest.mock("@/hooks/useTasks", () => ({
  useTasks: (...args: unknown[]) => mockUseTasks(...args),
  useUpdateTask: () => ({ mutate: mockUpdateTask }),
  useDeleteTask: () => ({ mutate: mockDeleteTask }),
}));

jest.mock("@/hooks/useTasksSocket", () => ({
  useTasksSocket: () => undefined,
}));

jest.mock("@/components/Layout/Sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

jest.mock("@/components/Layout/TopBar", () => ({
  TopBar: () => <div data-testid="topbar" />,
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe("ArchivePage", () => {
  beforeEach(() => {
    mockUpdateTask.mockClear();
    mockDeleteTask.mockClear();
    mockUseTasks.mockReturnValue({
      data: [
        {
          id: "TASK-001",
          title: "Finished feature",
          status: "Done",
          spec: "",
          repo: "repo-1",
          archivedAt: "2026-02-25T10:00:00.000Z",
        },
        {
          id: "TASK-002",
          title: "In progress task",
          status: "In Progress",
          spec: "",
          repo: "repo-1",
        },
      ],
    });
  });

  it("shows only Done tasks, not In Progress tasks", () => {
    render(<ArchivePage repo="repo-1" />);
    expect(screen.getByText("Finished feature")).toBeInTheDocument();
    expect(screen.queryByText("In progress task")).not.toBeInTheDocument();
  });

  it("shows archived count in subheading", () => {
    render(<ArchivePage repo="repo-1" />);
    expect(screen.getByText(/Completed tasks \(1\)/)).toBeInTheDocument();
  });

  it("calls updateTask with status Backlog when Restore is clicked", () => {
    render(<ArchivePage repo="repo-1" />);
    fireEvent.click(screen.getByText("Restore"));
    expect(mockUpdateTask).toHaveBeenCalledWith({
      id: "TASK-001",
      status: "Backlog",
    });
  });

  it("shows empty state when no Done tasks exist", () => {
    mockUseTasks.mockReturnValueOnce({ data: [] });
    render(<ArchivePage repo="repo-1" />);
    expect(screen.getByText(/No archived tasks yet/)).toBeInTheDocument();
  });

  it("renders without crashing when a Done task has no archivedAt (sort fallback to 0)", () => {
    mockUseTasks.mockReturnValueOnce({
      data: [
        {
          id: "TASK-003",
          title: "No archived date task",
          status: "Done",
          spec: "",
          repo: "repo-1",
          // intentionally no archivedAt field
        },
      ],
    });
    render(<ArchivePage repo="repo-1" />);
    expect(screen.getByText("No archived date task")).toBeInTheDocument();
  });

  it("calls deleteTask with task id when Delete is selected from dropdown", async () => {
    const user = userEvent.setup();
    render(<ArchivePage repo="repo-1" />);

    const trigger = screen.getByRole("button", {
      name: "More actions for Finished feature",
    });
    await user.click(trigger);

    const deleteItem = await screen.findByText("Delete");
    await user.click(deleteItem);

    expect(mockDeleteTask).toHaveBeenCalledWith("TASK-001");
  });
});
