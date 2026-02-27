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
    spec: "",
    repo: "repo1",
  },
  {
    id: "2",
    title: "Add dark mode",
    status: "Backlog",
    spec: "",
    repo: "repo1",
  },
  {
    id: "3",
    title: "In Progress task",
    status: "In Progress",
    spec: "",
    repo: "repo1",
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
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
  });

  it("renders a sort combobox defaulting to Newest", () => {
    render(
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    expect(screen.getByRole("combobox", { name: /sort/i })).toBeInTheDocument();
  });

  it("sorts tasks A-Z by title when selected", async () => {
    render(
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    await userEvent.click(screen.getByRole("combobox", { name: /sort/i }));
    await userEvent.click(await screen.findByRole("option", { name: "A → Z" }));
    const buttons = screen.getAllByRole("button", { name: /to agent/i });
    expect(buttons[0]).toHaveAccessibleName("Send Add dark mode to agent");
    expect(buttons[1]).toHaveAccessibleName("Send Fix login bug to agent");
  });

  it("sorts tasks oldest-first when selected", async () => {
    render(
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
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
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={onNewTask} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /new task/i }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it("filters tasks by search query", async () => {
    render(
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
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
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    await userEvent.type(
      screen.getByPlaceholderText("Search issues..."),
      "zzz no match",
    );
    expect(
      screen.getByText("No issues match your search."),
    ).toBeInTheDocument();
  });

  it("does not delete a task when Space opens the ... menu (keyup-bleed guard)", async () => {
    const deleteMutate = jest.fn();
    (useDeleteTask as jest.Mock).mockReturnValue({ mutate: deleteMutate });
    render(
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    const trigger = screen.getByRole("button", {
      name: /more actions for fix login bug/i,
    });
    trigger.focus();
    await userEvent.keyboard(" ");
    expect(deleteMutate).not.toHaveBeenCalled();
  });

  it("calls handoverTask when Send to Agent is clicked", async () => {
    const handoverMutate = jest.fn();
    (useHandoverTask as jest.Mock).mockReturnValue({ mutate: handoverMutate });
    render(
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Send Fix login bug to agent" }),
    );
    expect(handoverMutate).toHaveBeenCalledWith("1");
  });

  it("calls onSelectTask when a task row is clicked", async () => {
    const onSelectTask = jest.fn();
    render(
      <Backlog
        repo="repo1"
        onSelectTask={onSelectTask}
        onNewTask={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByText("Fix login bug"));
    expect(onSelectTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", title: "Fix login bug" }),
    );
  });

  it("calls deleteTask when Delete menu item is selected", async () => {
    const deleteMutate = jest.fn();
    (useDeleteTask as jest.Mock).mockReturnValue({ mutate: deleteMutate });
    render(
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /more actions for fix login bug/i }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /delete/i }),
    );
    expect(deleteMutate).toHaveBeenCalledWith("1");
  });

  it("shows different empty state when backlog has no tasks at all", () => {
    (useTasks as jest.Mock).mockReturnValue({ data: [] });
    render(
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    expect(screen.getByText(/no issues in the backlog/i)).toBeInTheDocument();
  });

  it("search and sort work together", async () => {
    render(
      <Backlog repo="repo1" onSelectTask={jest.fn()} onNewTask={jest.fn()} />,
    );
    // Filter to only "Add dark mode" by searching
    await userEvent.type(
      screen.getByPlaceholderText("Search issues..."),
      "dark",
    );
    expect(screen.getByText("Add dark mode")).toBeInTheDocument();
    expect(screen.queryByText("Fix login bug")).not.toBeInTheDocument();

    // Change sort — filtered result should still be the single match
    await userEvent.click(screen.getByRole("combobox", { name: /sort/i }));
    await userEvent.click(await screen.findByRole("option", { name: "A → Z" }));
    expect(screen.getByText("Add dark mode")).toBeInTheDocument();
    expect(screen.queryByText("Fix login bug")).not.toBeInTheDocument();
  });
});
