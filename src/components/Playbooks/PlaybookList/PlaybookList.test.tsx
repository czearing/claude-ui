// src/components/Playbooks/PlaybookList/PlaybookList.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlaybookList } from "./PlaybookList";

const playbooks = [{ name: "bugfix" }, { name: "feature" }];

describe("PlaybookList", () => {
  it("renders all playbook names", () => {
    render(
      <PlaybookList
        playbooks={playbooks}
        selectedName={null}
        onSelect={jest.fn()}
        onNew={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "bugfix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "feature" })).toBeInTheDocument();
  });

  it("shows empty state when no playbooks", () => {
    render(
      <PlaybookList
        playbooks={[]}
        selectedName={null}
        onSelect={jest.fn()}
        onNew={jest.fn()}
      />,
    );
    expect(screen.getByText("No playbooks yet.")).toBeInTheDocument();
  });

  it("calls onSelect with the name when an item is clicked", async () => {
    const onSelect = jest.fn();
    render(
      <PlaybookList
        playbooks={playbooks}
        selectedName={null}
        onSelect={onSelect}
        onNew={jest.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "bugfix" }));
    expect(onSelect).toHaveBeenCalledWith("bugfix");
  });

  it("calls onNew when the New button is clicked", async () => {
    const onNew = jest.fn();
    render(
      <PlaybookList
        playbooks={playbooks}
        selectedName={null}
        onSelect={jest.fn()}
        onNew={onNew}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "New playbook" }),
    );
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("renders the selected item", () => {
    render(
      <PlaybookList
        playbooks={playbooks}
        selectedName="bugfix"
        onSelect={jest.fn()}
        onNew={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "bugfix" })).toBeInTheDocument();
  });
});
