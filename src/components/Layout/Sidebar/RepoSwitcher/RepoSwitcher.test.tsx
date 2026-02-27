// src/components/Layout/Sidebar/RepoSwitcher/RepoSwitcher.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RepoSwitcher } from "./RepoSwitcher";

const mockPush = jest.fn();

jest.mock("@/hooks/useRepos", () => ({
  useRepos: () => ({
    data: [
      {
        id: "repo-1",
        name: "Frontend",
        path: "/code/frontend",
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "repo-2",
        name: "Backend",
        path: "/code/backend",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ],
  }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/repos/repo-1/board",
}));

jest.mock("./AddRepoDialog", () => ({
  AddRepoDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="add-repo-dialog" /> : null,
}));

describe("RepoSwitcher", () => {
  beforeEach(() => mockPush.mockClear());

  it("shows the active repo name in the trigger", () => {
    render(<RepoSwitcher activeRepoName="Frontend" />);
    expect(screen.getByText("Frontend")).toBeInTheDocument();
  });

  it("shows 'Select repo' when activeRepoName does not match any repo", () => {
    render(<RepoSwitcher activeRepoName="unknown" />);
    expect(screen.getByText("Select repo")).toBeInTheDocument();
  });

  it("opens the dropdown listing all repos", async () => {
    render(<RepoSwitcher activeRepoName="Frontend" />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("Backend")).toBeInTheDocument();
  });

  it("shows an 'Add repo' option in the dropdown", async () => {
    render(<RepoSwitcher activeRepoName="Frontend" />);
    await userEvent.click(screen.getByRole("button"));
    expect(await screen.findByText("Add repo")).toBeInTheDocument();
  });

  it("navigates to a repo's board when its name is selected in the dropdown", async () => {
    render(<RepoSwitcher activeRepoName="Frontend" />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByText("Backend"));
    expect(mockPush).toHaveBeenCalledWith("/repos/Backend/board"); // no encoding needed for "Backend"
  });

  it("opens the AddRepoDialog when 'Add repo' is selected", async () => {
    render(<RepoSwitcher activeRepoName="Frontend" />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByText("Add repo"));
    expect(screen.getByTestId("add-repo-dialog")).toBeInTheDocument();
  });
});
