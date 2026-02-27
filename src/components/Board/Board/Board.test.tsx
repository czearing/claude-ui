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
    spec: "",
    repo: "repo1",
  },
  {
    id: "2",
    title: "Review task",
    status: "Review",
    spec: "",
    repo: "repo1",
  },
  {
    id: "3",
    title: "Done task",
    status: "Done",
    spec: "",
    repo: "repo1",
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
    render(<Board repo="repo1" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(
      screen.getByRole("heading", { name: "In Progress" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
  });

  it("shows In Progress tasks on the board", () => {
    render(<Board repo="repo1" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(screen.getByText("In-progress task")).toBeInTheDocument();
  });

  it("shows Review tasks on the board", () => {
    render(<Board repo="repo1" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(screen.getByText("Review task")).toBeInTheDocument();
  });

  it("Done column is always empty — Done tasks are never rendered on the board", () => {
    render(<Board repo="repo1" tasks={tasks} onSelectTask={jest.fn()} />);
    expect(screen.queryByText("Done task")).not.toBeInTheDocument();
  });

  it("renders a new In Progress card when tasks prop gains a task:created entry", () => {
    const { rerender } = render(
      <Board repo="repo1" tasks={tasks} onSelectTask={jest.fn()} />,
    );

    const createdTask: Task = {
      id: "4",
      title: "Newly Created Task",
      status: "In Progress",
      spec: "",
      repo: "repo1",
    };

    rerender(
      <Board
        repo="repo1"
        tasks={[...tasks, createdTask]}
        onSelectTask={jest.fn()}
      />,
    );

    expect(screen.getByText("Newly Created Task")).toBeInTheDocument();
  });

  it("calls updateTask with new status when drag ends on a valid column (Review to Done)", () => {
    const updateMutate = jest.fn();
    (useUpdateTask as jest.Mock).mockReturnValue({ mutate: updateMutate });
    render(<Board repo="repo1" tasks={tasks} onSelectTask={jest.fn()} />);

    // Task "2" is in Review status. Review → Done is the only valid cross-column
    // move for a Review task (it can be archived but cannot go back to In Progress).
    capturedDragEnd?.({
      active: { id: "2" } as DragEndEvent["active"],
      over: { id: "Done" } as DragEndEvent["over"],
    } as DragEndEvent);

    expect(updateMutate).toHaveBeenCalledWith({ id: "2", status: "Done" });
  });

  it("does not allow dragging In Progress tasks to Review", () => {
    // The "Review" status is set exclusively by the agent when it finishes work.
    // Allowing a user to drag an In Progress card into Review would bypass the
    // agent handoff and put the task into a misleading state where it appears
    // ready for human review but the agent may still be running.
    const updateMutate = jest.fn();
    (useUpdateTask as jest.Mock).mockReturnValue({ mutate: updateMutate });
    render(<Board repo="repo1" tasks={tasks} onSelectTask={jest.fn()} />);

    capturedDragEnd?.({
      active: { id: "1" } as DragEndEvent["active"],
      over: { id: "Review" } as DragEndEvent["over"],
    } as DragEndEvent);

    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("does not call updateTask when drag is cancelled (no over target)", () => {
    const updateMutate = jest.fn();
    (useUpdateTask as jest.Mock).mockReturnValue({ mutate: updateMutate });
    render(<Board repo="repo1" tasks={tasks} onSelectTask={jest.fn()} />);

    capturedDragEnd?.({
      active: { id: "1" } as DragEndEvent["active"],
      over: null,
    } as DragEndEvent);

    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("does not call updateTask when dragging a task to its current position", () => {
    const updateMutate = jest.fn();
    (useUpdateTask as jest.Mock).mockReturnValue({ mutate: updateMutate });
    render(<Board repo="repo1" tasks={tasks} onSelectTask={jest.fn()} />);

    // active.id === over.id means dropped on itself
    capturedDragEnd?.({
      active: { id: "1" } as DragEndEvent["active"],
      over: { id: "1" } as DragEndEvent["over"],
    } as DragEndEvent);

    expect(updateMutate).not.toHaveBeenCalled();
  });
});
