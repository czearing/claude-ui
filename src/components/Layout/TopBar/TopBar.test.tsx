// src/components/Layout/TopBar/TopBar.test.tsx
import { render, screen } from "@testing-library/react";

import { TopBar } from "./TopBar";

jest.mock("@/hooks/useRepos", () => ({
  useRepos: () => ({
    data: [
      {
        id: "repo-1",
        name: "My Repo",
        path: "/code/my-repo",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ],
  }),
}));

describe("TopBar", () => {
  it("renders the repo name from useRepos", () => {
    render(<TopBar repo="My Repo" currentView="Board" />);
    expect(screen.getByText("My Repo")).toBeInTheDocument();
  });

  it("renders the repo name as fallback when not found in list", () => {
    render(<TopBar repo="unknown" currentView="Board" />);
    expect(screen.getByText("unknown")).toBeInTheDocument();
  });

  it("renders the current view in the breadcrumb", () => {
    render(<TopBar repo="My Repo" currentView="Tasks" />);
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });
});
