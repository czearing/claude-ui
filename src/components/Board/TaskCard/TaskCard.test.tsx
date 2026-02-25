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
      <TaskCard
        task={notStartedTask}
        onSelect={onSelect}
        onRemove={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows Delete option in the dropdown", async () => {
    render(
      <TaskCard
        task={notStartedTask}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
      />,
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
      <TaskCard
        task={notStartedTask}
        onSelect={jest.fn()}
        onRemove={onRemove}
      />,
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
      <TaskCard
        task={notStartedTask}
        onSelect={onSelect}
        onRemove={jest.fn()}
      />,
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

  it("applies selected styling when the selected prop is true", () => {
    render(
      <TaskCard task={notStartedTask} onSelect={jest.fn()} selected={true} />,
    );
    // identity-obj-proxy returns the class key as the string value
    const card = screen
      .getByText("Fix the bug")
      .closest('[class*="card"]') as HTMLElement;
    expect(card).toHaveClass("cardSelected");
  });
});

describe("TaskCard keyboard accessibility", () => {
  it("Task actions button has an accessible label", () => {
    render(
      <TaskCard
        task={notStartedTask}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Task actions" }),
    ).toBeInTheDocument();
  });

  it("menu opens when Enter is pressed on the focused trigger", async () => {
    render(
      <TaskCard
        task={notStartedTask}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Task actions" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("menu opens when Space is pressed on the focused trigger", async () => {
    render(
      <TaskCard
        task={notStartedTask}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Task actions" });
    trigger.focus();
    await userEvent.keyboard(" ");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("Escape key closes an open dropdown", async () => {
    render(
      <TaskCard
        task={notStartedTask}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("ArrowDown key moves focus through menu items", async () => {
    render(
      <TaskCard
        task={notStartedTask}
        onSelect={jest.fn()}
        onRemove={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    const items = await screen.findAllByRole("menuitem");
    // Radix focuses the menu container on open; first ArrowDown moves to item[0]
    await userEvent.keyboard("{ArrowDown}");
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
  });

  it("menu item can be activated with Enter after keyboard navigation", async () => {
    const onRemove = jest.fn();
    render(
      <TaskCard
        task={notStartedTask}
        onSelect={jest.fn()}
        onRemove={onRemove}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Task actions" }));
    await screen.findByRole("menu");
    // menu container focused → ArrowDown → View prompt → ArrowDown → Delete → Enter
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    expect(onRemove).toHaveBeenCalledWith("task-1");
  });
});
