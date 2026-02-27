// src/app/repos/[repo]/agents/AgentsPage.test.tsx
import { act, render, screen } from "@testing-library/react";

import { AgentsPage } from "./AgentsPage";

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
const mockUseAgents = jest.fn();
const mockUseAgent = jest.fn();

jest.mock("@/hooks/useAgents", () => ({
  useAgents: (...args: unknown[]) => mockUseAgents(...args),
  useAgent: (...args: unknown[]) => mockUseAgent(...args),
  useCreateAgent: () => ({ mutate: mockCreate }),
  useUpdateAgent: () => ({ mutate: mockUpdate }),
  useDeleteAgent: () => ({ mutate: mockDelete }),
}));

jest.mock("@/components/Layout/Sidebar", () => ({
  Sidebar: () => null,
}));

jest.mock("@/components/Agents/AgentList", () => ({
  AgentList: (props: {
    agents: { name: string }[];
    selectedName: string | null;
    onNew: () => void;
    onSelect: (name: string) => void;
    onScopeChange: (scope: "global" | "repo") => void;
    scope: "global" | "repo";
  }) => {
    capturedOnNew = props.onNew;
    capturedOnSelect = props.onSelect;
    capturedOnScopeChange = props.onScopeChange;
    return <div data-testid="agent-list" />;
  },
}));

jest.mock("@/components/Agents/AgentEditor", () => ({
  AgentEditor: (props: {
    onChange: (description: string, content: string) => void;
    onRename: (newName: string) => void;
    onDelete: () => void;
  }) => {
    capturedOnChange = props.onChange;
    capturedOnRename = props.onRename;
    capturedOnDelete = props.onDelete;
    return <div data-testid="agent-editor" />;
  },
}));

beforeEach(() => {
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockUseAgents.mockReturnValue({
    data: [{ name: "agent-1", description: "" }],
  });
  // Return agent data only when explicitly selected by name
  mockUseAgent.mockImplementation((name: string | null) => ({
    data:
      name === "agent-1"
        ? { name: "agent-1", description: "", content: "" }
        : undefined,
  }));
});

describe("AgentsPage", () => {
  it("shows empty state when no agent is selected", () => {
    render(<AgentsPage repo="repo-1" />);
    expect(
      screen.getByText("Select an agent or create a new one."),
    ).toBeInTheDocument();
  });

  it("shows the AgentEditor when an agent is selected", () => {
    render(<AgentsPage repo="repo-1" />);
    act(() => capturedOnSelect("agent-1"));
    expect(screen.getByTestId("agent-editor")).toBeInTheDocument();
  });

  it("hides the editor and shows empty state after scope changes", () => {
    render(<AgentsPage repo="repo-1" />);
    act(() => capturedOnSelect("agent-1"));
    expect(screen.getByTestId("agent-editor")).toBeInTheDocument();

    act(() => capturedOnScopeChange("repo"));
    expect(screen.queryByTestId("agent-editor")).not.toBeInTheDocument();
    expect(
      screen.getByText("Select an agent or create a new one."),
    ).toBeInTheDocument();
  });

  it("calls createAgent with the next unique name when New is clicked", () => {
    render(<AgentsPage repo="repo-1" />);
    act(() => capturedOnNew());
    // counterRef starts at 0 → first candidate "agent-1" is taken → uses "agent-2"
    expect(mockCreate).toHaveBeenCalledWith(
      { name: "agent-2", description: "", content: "" },
      expect.any(Object),
    );
  });

  it("calls updateAgent when the editor's onChange fires", () => {
    render(<AgentsPage repo="repo-1" />);
    act(() => capturedOnSelect("agent-1"));
    act(() => capturedOnChange("My description", "# Content"));
    expect(mockUpdate).toHaveBeenCalledWith({
      name: "agent-1",
      description: "My description",
      content: "# Content",
    });
  });

  it("calls deleteAgent and clears the selection when onDelete fires", () => {
    render(<AgentsPage repo="repo-1" />);
    act(() => capturedOnSelect("agent-1"));
    expect(screen.getByTestId("agent-editor")).toBeInTheDocument();

    mockDelete.mockImplementation(
      (_name: string, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
    act(() => capturedOnDelete());

    expect(mockDelete).toHaveBeenCalledWith("agent-1", expect.any(Object));
    expect(screen.queryByTestId("agent-editor")).not.toBeInTheDocument();
  });

  it("renames an agent by creating the new name then deleting the old one", () => {
    mockCreate.mockImplementation(
      (_input: unknown, opts?: { onSuccess?: () => void }) => {
        opts?.onSuccess?.();
      },
    );
    render(<AgentsPage repo="repo-1" />);
    act(() => capturedOnSelect("agent-1"));
    act(() => capturedOnRename("agent-renamed"));

    expect(mockCreate).toHaveBeenCalledWith(
      { name: "agent-renamed", description: "", content: "" },
      expect.any(Object),
    );
    expect(mockDelete).toHaveBeenCalledWith("agent-1");
  });
});
