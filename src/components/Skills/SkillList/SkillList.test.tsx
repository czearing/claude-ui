// src/components/Skills/SkillList/SkillList.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SkillList } from "./SkillList";

const skills = [
  { name: "bugfix", description: "Fix bugs" },
  { name: "feature", description: "Build features" },
];

const defaultProps = {
  selectedName: null as string | null,
  onSelect: jest.fn(),
  onNew: jest.fn(),
  scope: "global" as const,
  onScopeChange: jest.fn(),
};

describe("SkillList", () => {
  it("renders all skill names", () => {
    render(<SkillList {...defaultProps} skills={skills} />);
    expect(screen.getByRole("button", { name: "bugfix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "feature" })).toBeInTheDocument();
  });

  it("shows empty state when no skills", () => {
    render(<SkillList {...defaultProps} skills={[]} />);
    expect(screen.getByText("No skills yet.")).toBeInTheDocument();
  });

  it("calls onSelect with the name when an item is clicked", async () => {
    const onSelect = jest.fn();
    render(<SkillList {...defaultProps} skills={skills} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "bugfix" }));
    expect(onSelect).toHaveBeenCalledWith("bugfix");
  });

  it("calls onNew when the New button is clicked", async () => {
    const onNew = jest.fn();
    render(<SkillList {...defaultProps} skills={skills} onNew={onNew} />);
    await userEvent.click(screen.getByRole("button", { name: "New skill" }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("renders the selected item", () => {
    render(
      <SkillList {...defaultProps} skills={skills} selectedName="bugfix" />,
    );
    expect(screen.getByRole("button", { name: "bugfix" })).toBeInTheDocument();
  });

  it("renders Global and Repo scope buttons", () => {
    render(<SkillList {...defaultProps} skills={[]} />);
    expect(screen.getByRole("button", { name: "Global" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repo" })).toBeInTheDocument();
  });

  it("calls onScopeChange when Repo is clicked", async () => {
    const onScopeChange = jest.fn();
    render(
      <SkillList {...defaultProps} skills={[]} onScopeChange={onScopeChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Repo" }));
    expect(onScopeChange).toHaveBeenCalledWith("repo");
  });

  it("calls onScopeChange when Global is clicked", async () => {
    const onScopeChange = jest.fn();
    render(
      <SkillList
        {...defaultProps}
        skills={[]}
        scope="repo"
        onScopeChange={onScopeChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Global" }));
    expect(onScopeChange).toHaveBeenCalledWith("global");
  });
});
