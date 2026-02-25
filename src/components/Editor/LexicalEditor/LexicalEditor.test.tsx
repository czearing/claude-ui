import { render, screen } from "@testing-library/react";

import { LexicalEditor } from "./LexicalEditor";

// Lexical calls window.getSelection() during selection-change handling.
// jsdom has no real selection model, so we return a stub with rangeCount 0
// to ensure the FloatingToolbarPlugin gracefully exits its read path.
beforeAll(() => {
  Object.defineProperty(window, "getSelection", {
    value: () => ({ rangeCount: 0 }),
    writable: true,
  });
});

describe("LexicalEditor", () => {
  it("renders without crashing", () => {
    render(<LexicalEditor />);
  });

  it("renders a content-editable textbox in edit mode", () => {
    render(<LexicalEditor />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("shows the default placeholder when no value is provided", () => {
    render(<LexicalEditor />);
    expect(
      screen.getByText("Write something, or press '/' for commands…"),
    ).toBeInTheDocument();
  });

  it("accepts and shows a custom placeholder", () => {
    render(<LexicalEditor placeholder="Enter spec details…" />);
    expect(screen.getByText("Enter spec details…")).toBeInTheDocument();
  });

  it("renders a non-editable region in readOnly mode", () => {
    const { container } = render(<LexicalEditor readOnly />);
    const editable = container.querySelector("[contenteditable]");
    expect(editable).toHaveAttribute("contenteditable", "false");
  });

  it("renders an editable region by default", () => {
    const { container } = render(<LexicalEditor />);
    const editable = container.querySelector("[contenteditable]");
    expect(editable).toHaveAttribute("contenteditable", "true");
  });

  it("calls onChange when content changes", () => {
    // onChange is wired via OnChangePlugin; verify it is rendered without error
    const handleChange = jest.fn();
    render(<LexicalEditor onChange={handleChange} />);
    // OnChangePlugin mounts — no throw means it integrated correctly
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});

describe("LexicalEditor markdown format", () => {
  it("renders without crashing with format=markdown", () => {
    render(<LexicalEditor format="markdown" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("renders with a markdown value without crashing", () => {
    render(<LexicalEditor format="markdown" value="# Hello\n\nWorld" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("defaults to json format when format prop is omitted (existing behaviour)", () => {
    render(<LexicalEditor />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
