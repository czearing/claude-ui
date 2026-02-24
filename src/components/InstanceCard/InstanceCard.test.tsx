import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InstanceCard } from "./InstanceCard";
import type { InstanceCardProps } from "./InstanceCard.types";

const mockSession: InstanceCardProps["session"] = {
  id: "test-id-1",
  name: "Instance 1",
  createdAt: new Date().toISOString(),
};

describe("InstanceCard", () => {
  it("renders the session name", () => {
    render(
      <InstanceCard session={mockSession} onOpen={jest.fn()} onDelete={jest.fn()} />
    );

    expect(screen.getByText("Instance 1")).toBeInTheDocument();
  });

  it("renders a relative date", () => {
    render(
      <InstanceCard session={mockSession} onOpen={jest.fn()} onDelete={jest.fn()} />
    );

    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("calls onOpen with the session when the card is clicked", async () => {
    const onOpen = jest.fn();
    render(
      <InstanceCard session={mockSession} onOpen={onOpen} onDelete={jest.fn()} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Open Instance 1" }));

    expect(onOpen).toHaveBeenCalledWith(mockSession);
  });

  it("calls onDelete with the session id when the delete button is clicked", async () => {
    const onDelete = jest.fn();
    render(
      <InstanceCard session={mockSession} onOpen={jest.fn()} onDelete={onDelete} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete Instance 1" }));

    expect(onDelete).toHaveBeenCalledWith("test-id-1");
  });

  it("does not call onOpen when the delete button is clicked", async () => {
    const onOpen = jest.fn();
    render(
      <InstanceCard session={mockSession} onOpen={onOpen} onDelete={jest.fn()} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete Instance 1" }));

    expect(onOpen).not.toHaveBeenCalled();
  });
});
