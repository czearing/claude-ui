// src/components/Agents/AgentList/AgentList.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AgentList } from "./AgentList";

const agents = [
  { name: "code-reviewer", description: "Review code" },
  { name: "test-writer", description: "Write tests" },
];

const defaultProps = {
  selectedName: null as string | null,
  onSelect: jest.fn(),
  onNew: jest.fn(),
  scope: "global" as const,
  onScopeChange: jest.fn(),
};

describe("AgentList", () => {
  it("renders all agent names", () => {
    render(<AgentList {...defaultProps} agents={agents} />);
    expect(
      screen.getByRole("button", { name: "code-reviewer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "test-writer" }),
    ).toBeInTheDocument();
  });

  it('shows "Agents" as the list title', () => {
    render(<AgentList {...defaultProps} agents={agents} />);
    expect(screen.getByText("Agents")).toBeInTheDocument();
  });

  it("shows empty state when no agents", () => {
    render(<AgentList {...defaultProps} agents={[]} />);
    expect(screen.getByText("No agents yet.")).toBeInTheDocument();
  });

  it("calls onSelect with the name when an item is clicked", async () => {
    const onSelect = jest.fn();
    render(<AgentList {...defaultProps} agents={agents} onSelect={onSelect} />);
    await userEvent.click(
      screen.getByRole("button", { name: "code-reviewer" }),
    );
    expect(onSelect).toHaveBeenCalledWith("code-reviewer");
  });

  it("calls onNew when the New button is clicked", async () => {
    const onNew = jest.fn();
    render(<AgentList {...defaultProps} agents={agents} onNew={onNew} />);
    await userEvent.click(screen.getByRole("button", { name: "New agent" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("renders the selected item", () => {
    render(
      <AgentList
        {...defaultProps}
        agents={agents}
        selectedName="code-reviewer"
      />,
    );
    expect(
      screen.getByRole("button", { name: "code-reviewer" }),
    ).toBeInTheDocument();
  });

  it("renders Global and Repo scope buttons", () => {
    render(<AgentList {...defaultProps} agents={[]} />);
    expect(screen.getByRole("button", { name: "Global" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repo" })).toBeInTheDocument();
  });

  it("calls onScopeChange when Repo is clicked", async () => {
    const onScopeChange = jest.fn();
    render(
      <AgentList {...defaultProps} agents={[]} onScopeChange={onScopeChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Repo" }));
    expect(onScopeChange).toHaveBeenCalledWith("repo");
  });

  it("calls onScopeChange when Global is clicked", async () => {
    const onScopeChange = jest.fn();
    render(
      <AgentList
        {...defaultProps}
        agents={[]}
        scope="repo"
        onScopeChange={onScopeChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Global" }));
    expect(onScopeChange).toHaveBeenCalledWith("global");
  });
});
