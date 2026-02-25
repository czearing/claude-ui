import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useDeleteTask, useHandoverTask, useTasks } from "@/hooks/useTasks";
import { Backlog } from "./Backlog";

jest.mock("@/hooks/useTasks", () => ({
  useTasks: jest.fn(),
  useDeleteTask: jest.fn(),
  useHandoverTask: jest.fn(),
}));

jest.mock("@/hooks/useTasksSocket", () => ({
  useTasksSocket: jest.fn(),
}));

jest.mock("@/utils/formatRelativeDate", () => ({
  formatRelativeDate: () => "2h ago",
}));

const mockTasks = [
  {
    id: "1",
    title: "Fix login bug",
    status: "Backlog",
    priority: "High",
    spec: "",
    repoId: "repo1",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "2",
    title: "Add dark mode",
    status: "Backlog",
    priority: "Medium",
    spec: "",
    repoId: "repo1",
    createdAt: "2024-01-02T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
  {
    id: "3",
    title: "In Progress task",
    status: "In Progress",
    priority: "Medium",
    spec: "",
    repoId: "repo1",
    createdAt: "2024-01-03T00:00:00Z",
    updatedAt: "2024-01-03T00:00:00Z",
  },
];

beforeEach(() => {
  (useTasks as jest.Mock).mockReturnValue({ data: mockTasks });
  (useDeleteTask as jest.Mock).mockReturnValue({ mutate: jest.fn() });
  (useHandoverTask as jest.Mock).mockReturnValue({ mutate: jest.fn() });
});

describe("Backlog", () => {
  it("renders the heading", () => {
    render(
      <Backlog repoId="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
  });

  it("renders a sort combobox defaulting to Newest", () => {
    render(
      <Backlog repoId="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    expect(screen.getByRole("combobox", { name: /sort/i })).toBeInTheDocument();
  });

  it("sorts tasks A-Z by title when selected", async () => {
    render(
      <Backlog repoId="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: /sort/i }));
    await userEvent.click(await screen.findByRole("option", { name: "A → Z" }));
    const buttons = screen.getAllByRole("button", { name: /to agent/i });
    expect(buttons[0]).toHaveAccessibleName("Send Add dark mode to agent");
    expect(buttons[1]).toHaveAccessibleName("Send Fix login bug to agent");
  });

  it("sorts tasks oldest-first when selected", async () => {
    render(
      <Backlog repoId="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: /sort/i }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Oldest" }),
    );
    const buttons = screen.getAllByRole("button", { name: /to agent/i });
    expect(buttons[0]).toHaveAccessibleName("Send Fix login bug to agent");
    expect(buttons[1]).toHaveAccessibleName("Send Add dark mode to agent");
  });

  it("calls onNewTask when New Task button is clicked", async () => {
    const onNewTask = jest.fn();
    render(
      <Backlog repoId="repo1" onSelectTask={jest.fn()} onNewTask={onNewTask} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /new task/i }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it("filters tasks by search query", async () => {
    render(
      <Backlog repoId="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    await userEvent.type(
      screen.getByPlaceholderText("Search issues..."),
      "login",
    );
    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.queryByText("Add dark mode")).not.toBeInTheDocument();
  });

  it("shows empty state message when no tasks match search", async () => {
    render(
      <Backlog repoId="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    await userEvent.type(
      screen.getByPlaceholderText("Search issues..."),
      "zzz no match",
    );
    expect(
      screen.getByText("No issues match your search."),
    ).toBeInTheDocument();
  });

  it("calls handoverTask when Send to Agent is clicked", async () => {
    const handoverMutate = jest.fn();
    (useHandoverTask as jest.Mock).mockReturnValue({ mutate: handoverMutate });
    render(
      <Backlog repoId="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Send Fix login bug to agent" }),
    );
    expect(handoverMutate).toHaveBeenCalledWith("1");
  });
});
