// src/components/Layout/Sidebar/Sidebar.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Task } from "@/utils/tasks.types";
import { Sidebar } from "./Sidebar";

const mockPush = jest.fn();
const mockUseTasks = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("./RepoSwitcher", () => ({
  RepoSwitcher: () => <div data-testid="repo-switcher" />,
}));

jest.mock("@/hooks/useTasks", () => ({
  useTasks: (...args: unknown[]) => mockUseTasks(...args),
}));

const baseTask: Task = {
  id: "t-1",
  title: "Fix bug",
  status: "Backlog",
  spec: "",
  repo: "repo-1",
};

describe("Sidebar", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockUseTasks.mockReturnValue({ data: [] });
  });

  it("renders all nav items", () => {
    render(<Sidebar currentView="Board" repo="repo-1" />);
    expect(screen.getByRole("button", { name: "Board" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Archives" }),
    ).toBeInTheDocument();
  });

  it("renders the RepoSwitcher", () => {
    render(<Sidebar currentView="Board" repo="repo-1" />);
    expect(screen.getByTestId("repo-switcher")).toBeInTheDocument();
  });

  it('shows "Idle" when no task is In Progress', () => {
    mockUseTasks.mockReturnValue({ data: [baseTask] });
    render(<Sidebar currentView="Board" repo="repo-1" />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it('shows "Active" when a task is In Progress', () => {
    mockUseTasks.mockReturnValue({
      data: [{ ...baseTask, status: "In Progress" }],
    });
    render(<Sidebar currentView="Board" repo="repo-1" />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("navigates to board when Board is clicked", async () => {
    render(<Sidebar currentView="Tasks" repo="repo-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(mockPush).toHaveBeenCalledWith("/repos/repo-1/board");
  });

  it("navigates to tasks when Tasks is clicked", async () => {
    render(<Sidebar currentView="Board" repo="repo-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(mockPush).toHaveBeenCalledWith("/repos/repo-1/tasks");
  });

  it("navigates to skills when Skills is clicked", async () => {
    render(<Sidebar currentView="Board" repo="repo-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(mockPush).toHaveBeenCalledWith("/repos/repo-1/skills");
  });

  it("navigates to agents when Agents is clicked", async () => {
    render(<Sidebar currentView="Board" repo="repo-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(mockPush).toHaveBeenCalledWith("/repos/repo-1/agents");
  });

  it("navigates to archive when Archives is clicked", async () => {
    render(<Sidebar currentView="Board" repo="repo-1" />);
    await userEvent.click(screen.getByRole("button", { name: "Archives" }));
    expect(mockPush).toHaveBeenCalledWith("/repos/repo-1/archive");
  });

  it("does not navigate when repo is undefined and a main nav item is clicked", async () => {
    render(<Sidebar currentView="Board" />);
    await userEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
