// src/app/repos/[repo]/skills/SkillsPage.test.tsx
import { act, render, screen } from "@testing-library/react";

import { SkillsPage } from "./SkillsPage";

// Callbacks captured from child component mocks
let capturedOnNew: () => void;
let capturedOnSelect: (name: string) => void;
let capturedOnScopeChange: (scope: "global" | "repo") => void;
let capturedOnChange: (description: string, content: string) => void;
let capturedOnRename: (newName: string) => void;
let capturedOnDelete: () => void;

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockUseSkills = jest.fn();
const mockUseSkill = jest.fn();

jest.mock("@/hooks/useSkills", () => ({
  useSkills: (...args: unknown[]) => mockUseSkills(...args),
  useSkill: (...args: unknown[]) => mockUseSkill(...args),
  useCreateSkill: () => ({ mutate: mockCreate }),
  useUpdateSkill: () => ({ mutate: mockUpdate }),
  useDeleteSkill: () => ({ mutate: mockDelete }),
}));

jest.mock("@/components/Layout/Sidebar", () => ({
  Sidebar: () => null,
}));

jest.mock("@/components/Skills/SkillList", () => ({
  SkillList: (props: {
    skills: { name: string }[];
    selectedName: string | null;
    onNew: () => void;
    onSelect: (name: string) => void;
    onScopeChange: (scope: "global" | "repo") => void;
    scope: "global" | "repo";
  }) => {
    capturedOnNew = props.onNew;
    capturedOnSelect = props.onSelect;
    capturedOnScopeChange = props.onScopeChange;
    return <div data-testid="skill-list" />;
  },
}));

jest.mock("@/components/Skills/SkillEditor", () => ({
  SkillEditor: (props: {
    onChange: (description: string, content: string) => void;
    onRename: (newName: string) => void;
    onDelete: () => void;
  }) => {
    capturedOnChange = props.onChange;
    capturedOnRename = props.onRename;
    capturedOnDelete = props.onDelete;
    return <div data-testid="skill-editor" />;
  },
}));

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockUseSkills.mockReturnValue({
    data: [{ name: "skill-1", description: "" }],
  });
  // Return skill data only when explicitly selected by name
  mockUseSkill.mockImplementation((name: string | null) => ({
    data:
      name === "skill-1"
        ? { name: "skill-1", description: "", content: "" }
        : undefined,
  }));
});

describe("SkillsPage", () => {
  it("shows empty state when no skill is selected", () => {
    render(<SkillsPage repo="repo-1" />);
    expect(
      screen.getByText("Select a skill or create a new one."),
    ).toBeInTheDocument();
  });

  it("shows the SkillEditor when a skill is selected", () => {
    render(<SkillsPage repo="repo-1" />);
    act(() => capturedOnSelect("skill-1"));
    expect(screen.getByTestId("skill-editor")).toBeInTheDocument();
  });

  it("hides the editor and shows empty state after scope changes", () => {
    render(<SkillsPage repo="repo-1" />);
    act(() => capturedOnSelect("skill-1"));
    expect(screen.getByTestId("skill-editor")).toBeInTheDocument();

    act(() => capturedOnScopeChange("repo"));
    expect(screen.queryByTestId("skill-editor")).not.toBeInTheDocument();
    expect(
      screen.getByText("Select a skill or create a new one."),
    ).toBeInTheDocument();
  });

  it("calls createSkill with the next unique name when New is clicked", () => {
    render(<SkillsPage repo="repo-1" />);
    act(() => capturedOnNew());
    // counterRef starts at 0 → first candidate "skill-1" is taken → uses "skill-2"
    expect(mockCreate).toHaveBeenCalledWith(
      { name: "skill-2", description: "", content: "" },
      expect.any(Object),
    );
  });

  it("calls updateSkill when the editor's onChange fires", () => {
    render(<SkillsPage repo="repo-1" />);
    act(() => capturedOnSelect("skill-1"));
    act(() => capturedOnChange("A description", "# Skill content"));
    expect(mockUpdate).toHaveBeenCalledWith({
      name: "skill-1",
      description: "A description",
      content: "# Skill content",
    });
  });

  it("calls deleteSkill and clears the selection when onDelete fires", () => {
    render(<SkillsPage repo="repo-1" />);
    act(() => capturedOnSelect("skill-1"));
    expect(screen.getByTestId("skill-editor")).toBeInTheDocument();

    mockDelete.mockImplementation(
      (_name: string, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
    act(() => capturedOnDelete());

    expect(mockDelete).toHaveBeenCalledWith("skill-1", expect.any(Object));
    expect(screen.queryByTestId("skill-editor")).not.toBeInTheDocument();
  });

  it("renames a skill by creating the new name then deleting the old one", () => {
    mockCreate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
    render(<SkillsPage repo="repo-1" />);
    act(() => capturedOnSelect("skill-1"));
    act(() => capturedOnRename("skill-renamed"));

    expect(mockCreate).toHaveBeenCalledWith(
      { name: "skill-renamed", description: "", content: "" },
      expect.any(Object),
    );
    expect(mockDelete).toHaveBeenCalledWith("skill-1");
  });
});
