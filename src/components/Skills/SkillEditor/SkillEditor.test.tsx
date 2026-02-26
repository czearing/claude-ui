// src/components/Skills/SkillEditor/SkillEditor.test.tsx
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SkillEditor } from "./SkillEditor";

// Capture the onChange callback passed to LexicalEditor so tests can fire it.
let capturedLexicalOnChange: ((val: string) => void) | undefined;

jest.mock("@/components/Editor/LexicalEditor", () => ({
  LexicalEditor: (props: {
    value?: string;
    onChange?: (val: string) => void;
  }) => {
    capturedLexicalOnChange = props.onChange;
    return <div data-testid="lexical-editor" />;
  },
}));

beforeEach(() => {
  capturedLexicalOnChange = undefined;
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
    expect(screen.getByTestId("lexical-editor")).toBeInTheDocument();
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

  it("does not call onChange when Lexical output differs from content only by trailing whitespace", () => {
    const onChange = jest.fn();
    render(
      <SkillEditor
        name="bugfix"
        description=""
        content="# Hello"
        onChange={onChange}
        onRename={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    // Lexical often appends a trailing newline — this should be suppressed.
    act(() => capturedLexicalOnChange?.("# Hello\n"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("calls onChange when Lexical output is genuinely different from content", () => {
    const onChange = jest.fn();
    const { unmount } = render(
      <SkillEditor
        name="bugfix"
        description=""
        content="# Hello"
        onChange={onChange}
        onRename={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    act(() => capturedLexicalOnChange?.("# Hello\n\nNew paragraph"));
    unmount();
    expect(onChange).toHaveBeenCalledWith("", "# Hello\n\nNew paragraph");
  });
});
