"use client";

import { render, screen } from "@testing-library/react";

import type { Task } from "@/utils/tasks.types";
import { Column } from "./Column";

jest.mock("@dnd-kit/core", () => ({
  useDroppable: jest.fn(() => ({ setNodeRef: jest.fn(), isOver: false })),
}));

jest.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) =>
    children as React.ReactElement,
  verticalListSortingStrategy: jest.fn(),
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
  CSS: { Transform: { toString: () => undefined } },
}));

const tasks: Task[] = [
  {
    id: "1",
    title: "Task Alpha",
    status: "Review",
    spec: "",
    repo: "repo1",
  },
  {
    id: "2",
    title: "Task Beta",
    status: "Review",
    spec: "",
    repo: "repo1",
  },
];

describe("Column", () => {
  it("renders the status heading", () => {
    render(<Column status="Review" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
  });

  it("shows the correct task count in the badge", () => {
    render(<Column status="Review" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows 0 in the badge when there are no tasks", () => {
    render(<Column status="Review" tasks={[]} onSelectTask={jest.fn()} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders a card for each task", () => {
    render(<Column status="Review" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(screen.getByText("Task Alpha")).toBeInTheDocument();
    expect(screen.getByText("Task Beta")).toBeInTheDocument();
  });

  it("renders with different statuses", () => {
    render(<Column status="In Progress" tasks={[]} onSelectTask={jest.fn()} />);
    expect(
      screen.getByRole("heading", { name: "In Progress" }),
    ).toBeInTheDocument();
  });
});
