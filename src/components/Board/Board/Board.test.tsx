"use client";

import type { DragEndEvent } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";

import { useDeleteTask, useRecallTask, useUpdateTask } from "@/hooks/useTasks";
import type { Task } from "@/utils/tasks.types";
import { Board } from "./Board";

let capturedDragEnd: ((e: DragEndEvent) => void) | undefined;

jest.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (e: DragEndEvent) => void;
  }) => {
    capturedDragEnd = onDragEnd;
    return children as React.ReactElement;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) =>
    children as React.ReactElement,
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCorners: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
  useDroppable: jest.fn(() => ({ setNodeRef: jest.fn(), isOver: false })),
}));

jest.mock("@dnd-kit/sortable", () => ({
  sortableKeyboardCoordinates: jest.fn(),
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

jest.mock("@/hooks/useTasks", () => ({
  useDeleteTask: jest.fn(),
  useRecallTask: jest.fn(),
  useUpdateTask: jest.fn(),
}));

jest.mock("@/hooks/useTasksSocket", () => ({
  useTasksSocket: jest.fn(),
}));

const tasks: Task[] = [
  {
    id: "1",
    title: "In-progress task",
    status: "In Progress",
    priority: "High",
    spec: "",
    repoId: "repo1",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "2",
    title: "Review task",
    status: "Review",
    priority: "Medium",
    spec: "",
    repoId: "repo1",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "3",
    title: "Done task",
    status: "Done",
    priority: "Low",
    spec: "",
    repoId: "repo1",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

beforeEach(() => {
  capturedDragEnd = undefined;
  (useUpdateTask as jest.Mock).mockReturnValue({ mutate: jest.fn() });
  (useDeleteTask as jest.Mock).mockReturnValue({ mutate: jest.fn() });
  (useRecallTask as jest.Mock).mockReturnValue({ mutate: jest.fn() });
});

describe("Board", () => {
  it("renders all three board columns", () => {
    render(<Board repoId="repo1" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(
      screen.getByRole("heading", { name: "In Progress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
  });

  it("shows In Progress tasks on the board", () => {
    render(<Board repoId="repo1" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(screen.getByText("In-progress task")).toBeInTheDocument();
  });

  it("shows Review tasks on the board", () => {
    render(<Board repoId="repo1" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(screen.getByText("Review task")).toBeInTheDocument();
  });

  it("Done column is always empty — Done tasks are never rendered on the board", () => {
    render(<Board repoId="repo1" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(screen.queryByText("Done task")).not.toBeInTheDocument();
  });

  it("renders a new In Progress card when tasks prop gains a task:created entry", () => {
    const { rerender } = render(
      <Board repoId="repo1" tasks={tasks} onSelectTask={jest.fn()} />,
    );

    const createdTask: Task = {
      id: "4",
      title: "Newly Created Task",
      status: "In Progress",
      priority: "High",
      spec: "",
      repoId: "repo1",
      createdAt: "2024-01-02T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    };

    rerender(
      <Board
        repoId="repo1"
        tasks={[...tasks, createdTask]}
        onSelectTask={jest.fn()}
      />,
    );

    expect(screen.getByText("Newly Created Task")).toBeInTheDocument();
  });

  it("calls updateTask with new status when drag ends on a different column", () => {
    const updateMutate = jest.fn();
    (useUpdateTask as jest.Mock).mockReturnValue({ mutate: updateMutate });
    render(<Board repoId="repo1" tasks={tasks} onSelectTask={jest.fn()} />);

    capturedDragEnd?.({
      active: { id: "1" } as DragEndEvent["active"],
      over: { id: "Review" } as DragEndEvent["over"],
    } as DragEndEvent);

    expect(updateMutate).toHaveBeenCalledWith({ id: "1", status: "Review" });
  });

  it("does not call updateTask when drag is cancelled (no over target)", () => {
    const updateMutate = jest.fn();
    (useUpdateTask as jest.Mock).mockReturnValue({ mutate: updateMutate });
    render(<Board repoId="repo1" tasks={tasks} onSelectTask={jest.fn()} />);

    capturedDragEnd?.({
      active: { id: "1" } as DragEndEvent["active"],
      over: null,
    } as DragEndEvent);

    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("does not call updateTask when dragging a task to its current position", () => {
    const updateMutate = jest.fn();
    (useUpdateTask as jest.Mock).mockReturnValue({ mutate: updateMutate });
    render(<Board repoId="repo1" tasks={tasks} onSelectTask={jest.fn()} />);

    // active.id === over.id means dropped on itself
    capturedDragEnd?.({
      active: { id: "1" } as DragEndEvent["active"],
      over: { id: "1" } as DragEndEvent["over"],
    } as DragEndEvent);

    expect(updateMutate).not.toHaveBeenCalled();
  });
});
