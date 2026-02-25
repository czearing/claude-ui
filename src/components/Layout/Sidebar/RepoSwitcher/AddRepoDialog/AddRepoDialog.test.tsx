// src/components/Layout/Sidebar/RepoSwitcher/AddRepoDialog/AddRepoDialog.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AddRepoDialog } from "./AddRepoDialog";

const mockMutate = jest.fn();
const mockReset = jest.fn();

const mockUseCreateRepo = jest.fn();

jest.mock("@/hooks/useRepos", () => ({
  useCreateRepo: (...args: unknown[]) => mockUseCreateRepo(...args),
}));

describe("AddRepoDialog", () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockReset.mockClear();
    mockUseCreateRepo.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      error: null,
      reset: mockReset,
    });
  });

  it("renders the dialog title when open", () => {
    render(
      <AddRepoDialog open={true} onClose={jest.fn()} onCreated={jest.fn()} />,
    );
    expect(
      screen.getByRole("heading", { name: "Add repo" }),
    ).toBeInTheDocument();
  });

  it("does not render content when closed", () => {
    render(
      <AddRepoDialog open={false} onClose={jest.fn()} onCreated={jest.fn()} />,
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("calls mutate with name and path on submit", async () => {
    render(
      <AddRepoDialog open={true} onClose={jest.fn()} onCreated={jest.fn()} />,
    );
    await userEvent.type(screen.getByLabelText("Name"), "Frontend");
    await userEvent.type(screen.getByLabelText("Path"), "/code/frontend");
    await userEvent.click(screen.getByRole("button", { name: "Add repo" }));
    expect(mockMutate).toHaveBeenCalledWith(
      { name: "Frontend", path: "/code/frontend" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("calls onClose when Cancel is clicked", async () => {
    const onClose = jest.fn();
    render(
      <AddRepoDialog open={true} onClose={onClose} onCreated={jest.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows 'Adding…' on the submit button when isPending", () => {
    mockUseCreateRepo.mockReturnValue({
      mutate: mockMutate,
      isPending: true,
      error: null,
      reset: mockReset,
    });
    render(
      <AddRepoDialog open={true} onClose={jest.fn()} onCreated={jest.fn()} />,
    );
    expect(screen.getByRole("button", { name: /adding/i })).toBeInTheDocument();
  });

  it("disables the submit button when isPending", () => {
    mockUseCreateRepo.mockReturnValue({
      mutate: mockMutate,
      isPending: true,
      error: null,
      reset: mockReset,
    });
    render(
      <AddRepoDialog open={true} onClose={jest.fn()} onCreated={jest.fn()} />,
    );
    expect(screen.getByRole("button", { name: /adding/i })).toBeDisabled();
  });

  it("shows the error message when createRepo.error is set", () => {
    mockUseCreateRepo.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
      error: new Error("Path already registered"),
      reset: mockReset,
    });
    render(
      <AddRepoDialog open={true} onClose={jest.fn()} onCreated={jest.fn()} />,
    );
    expect(screen.getByText("Path already registered")).toBeInTheDocument();
  });

  it("calls onCreated with the new repo id on success", async () => {
    const onCreated = jest.fn();
    mockMutate.mockImplementation(
      (
        _input: unknown,
        options: { onSuccess: (repo: { id: string }) => void },
      ) => {
        options.onSuccess({ id: "repo-new" });
      },
    );
    render(
      <AddRepoDialog open={true} onClose={jest.fn()} onCreated={onCreated} />,
    );
    await userEvent.type(screen.getByLabelText("Name"), "New Repo");
    await userEvent.type(screen.getByLabelText("Path"), "/code/new");
    await userEvent.click(screen.getByRole("button", { name: "Add repo" }));
    expect(onCreated).toHaveBeenCalledWith("repo-new");
  });
});
