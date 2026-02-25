// src/components/Skills/SkillEditor/SkillEditor.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SkillEditor } from "./SkillEditor";

beforeAll(() => {
  Object.defineProperty(window, "getSelection", {
    value: () => ({ rangeCount: 0 }),
    writable: true,
  });
});

describe("SkillEditor", () => {
  it("renders with the skill name in the name input", () => {
    render(
      <SkillEditor
        name="bugfix"
        description=""
        content=""
        onChange={jest.fn()}
        onRename={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Skill name" })).toHaveValue(
      "bugfix",
    );
  });

  it("renders the Lexical editor body", () => {
    render(
      <SkillEditor
        name="bugfix"
        description=""
        content=""
        onChange={jest.fn()}
        onRename={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    const editables = document.querySelectorAll("[contenteditable]");
    expect(editables.length).toBeGreaterThan(0);
  });

  it("calls onDelete when the delete button is clicked", async () => {
    const onDelete = jest.fn();
    render(
      <SkillEditor
        name="bugfix"
        description=""
        content=""
        onChange={jest.fn()}
        onRename={jest.fn()}
        onDelete={onDelete}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Delete skill" }),
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("calls onRename with sanitized name on blur when name changes", async () => {
    const onRename = jest.fn();
    render(
      <SkillEditor
        name="bugfix"
        description=""
        content=""
        onChange={jest.fn()}
        onRename={onRename}
        onDelete={jest.fn()}
      />,
    );
    const nameInput = screen.getByRole("textbox", { name: "Skill name" });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "New Feature");
    await userEvent.tab();
    expect(onRename).toHaveBeenCalledWith("new-feature");
  });

  it("does not call onRename when name is unchanged", async () => {
    const onRename = jest.fn();
    render(
      <SkillEditor
        name="bugfix"
        description=""
        content=""
        onChange={jest.fn()}
        onRename={onRename}
        onDelete={jest.fn()}
      />,
    );
    const nameInput = screen.getByRole("textbox", { name: "Skill name" });
    await userEvent.click(nameInput);
    await userEvent.tab();
    expect(onRename).not.toHaveBeenCalled();
  });
});
