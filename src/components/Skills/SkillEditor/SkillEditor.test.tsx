// src/components/Skills/SkillEditor/SkillEditor.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
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
    await userEvent.click(screen.getByRole("button", { name: "Delete skill" }));
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

  it("pressing Enter on name input after changing name calls onRename", async () => {
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
    await userEvent.keyboard("{Enter}");
    expect(onRename).toHaveBeenCalledWith("new-feature");
  });

  it("pressing Escape on name input reverts the displayed name to original", async () => {
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
    const nameInput = screen.getByRole("textbox", { name: "Skill name" });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Some other name");
    await userEvent.keyboard("{Escape}");
    // After Escape, the input should display the original name
    expect(nameInput).toHaveValue("bugfix");
  });

  it("changing description input calls onChange after debounce flushes on unmount", () => {
    const onChange = jest.fn();
    const { unmount } = render(
      <SkillEditor
        name="bugfix"
        description="old description"
        content="some content"
        onChange={onChange}
        onRename={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    const descInput = screen.getByRole("textbox", {
      name: "Skill description",
    });
    fireEvent.change(descInput, { target: { value: "new description" } });
    // Unmount flushes the pending debounced callback
    unmount();
    expect(onChange).toHaveBeenCalledWith("new description", "some content");
  });
});
