"use client";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Task } from "@/utils/tasks.types";
import { TaskCard } from "./TaskCard";

jest.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

jest.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: { toString: () => undefined },
  },
}));

const notStartedTask: Task = {
  id: "task-1",
  title: "Fix the bug",
  status: "Not Started",
  priority: "Medium",
  spec: "",
  repoId: "repo-1",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const inProgressTask: Task = {
  ...notStartedTask,
  id: "task-2",
  title: "Agent task",
  status: "In Progress",
  sessionId: "session-abc",
};

describe("TaskCard", () => {
  it("renders the task title", () => {
    render(<TaskCard task={notStartedTask} onSelect={jest.fn()} />);
    expect(screen.getByText("Fix the bug")).toBeInTheDocument();
  });

  it("calls onSelect when the card body is clicked", async () => {
    const onSelect = jest.fn();
    render(<TaskCard task={notStartedTask} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Fix the bug"));
    expect(onSelect).toHaveBeenCalledWith(notStartedTask);
  });

  it("does NOT call onSelect when the ... trigger is clicked", async () => {
    const onSelect = jest.fn();
    render(
      <TaskCard task={notStartedTask} onSelect={onSelect} onRemove={jest.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows Delete option in the dropdown", async () => {
    render(
      <TaskCard task={notStartedTask} onSelect={jest.fn()} onRemove={jest.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    expect(
      await screen.findByRole("menuitem", { name: /delete/i }),
    ).toBeInTheDocument();
  });

  it("shows Move to Backlog for In Progress tasks", async () => {
    render(
      <TaskCard
        task={inProgressTask}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
        onRecall={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    expect(
      await screen.findByRole("menuitem", { name: /move to backlog/i }),
    ).toBeInTheDocument();
  });

  it("does not show Move to Backlog for non-In Progress tasks", async () => {
    render(
      <TaskCard
        task={notStartedTask}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
        onRecall={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    await screen.findByRole("menuitem", { name: /delete/i });
    expect(
      screen.queryByRole("menuitem", { name: /move to backlog/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onRemove with the task id when Delete is clicked", async () => {
    const onRemove = jest.fn();
    render(
      <TaskCard task={notStartedTask} onSelect={jest.fn()} onRemove={onRemove} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /delete/i }),
    );
    expect(onRemove).toHaveBeenCalledWith("task-1");
  });

  it("does NOT call onSelect when Delete is clicked", async () => {
    const onSelect = jest.fn();
    render(
      <TaskCard task={notStartedTask} onSelect={onSelect} onRemove={jest.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /delete/i }),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onRecall with the task id when Move to Backlog is clicked", async () => {
    const onRecall = jest.fn();
    render(
      <TaskCard
        task={inProgressTask}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
        onRecall={onRecall}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /move to backlog/i }),
    );
    expect(onRecall).toHaveBeenCalledWith("task-2");
  });

  it("does not render the ... trigger when no onRemove or onRecall is provided", () => {
    render(<TaskCard task={notStartedTask} onSelect={jest.fn()} />);
    expect(
      screen.queryByRole("button", { name: "Task actions" }),
    ).not.toBeInTheDocument();
  });

  it("shows the Agent Processing badge for In Progress tasks", () => {
    render(<TaskCard task={inProgressTask} onSelect={jest.fn()} />);
    expect(screen.getByText("Agent Processing...")).toBeInTheDocument();
  });

  it("shows the Terminal link when a sessionId is present", () => {
    render(<TaskCard task={inProgressTask} onSelect={jest.fn()} />);
    expect(screen.getByRole("link", { name: /terminal/i })).toBeInTheDocument();
  });
});
