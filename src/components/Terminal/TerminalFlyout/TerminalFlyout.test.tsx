import { act, fireEvent, render, screen } from "@testing-library/react";

import { TerminalFlyout } from "./TerminalFlyout";
import type { FlyoutSession } from "./TerminalFlyout.types";

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default:
    () =>
    ({ sessionId }: { sessionId: string }) => (
      <div data-testid={`terminal-${sessionId}`} />
    ),
}));

const sessions: FlyoutSession[] = [
  { sessionId: "ses-1", taskId: "t-1", title: "Fix auth bug" },
  { sessionId: "ses-2", taskId: "t-2", title: "Add pagination" },
];

const onSelectSession = jest.fn();
const onCloseTab = jest.fn();
const onClose = jest.fn();

function renderFlyout(activeSessionId = "ses-1") {
  return render(
    <TerminalFlyout
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSelectSession={onSelectSession}
      onCloseTab={onCloseTab}
      onClose={onClose}
    />,
  );
}

beforeEach(() => {
  onSelectSession.mockClear();
  onCloseTab.mockClear();
  onClose.mockClear();
});

describe("TerminalFlyout", () => {
  it("renders the flyout with tabs for each session", () => {
    renderFlyout();
    expect(screen.getByTestId("terminal-flyout")).toBeInTheDocument();
    expect(screen.getByText("Fix auth bug")).toBeInTheDocument();
    expect(screen.getByText("Add pagination")).toBeInTheDocument();
  });

  it("marks the active session tab as selected", () => {
    renderFlyout();
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("data-active", "true");
    expect(tabs[1]).toHaveAttribute("data-active", "false");
  });

  it("calls onSelectSession when a tab is clicked", () => {
    renderFlyout();
    fireEvent.click(screen.getByText("Add pagination"));
    expect(onSelectSession).toHaveBeenCalledWith("ses-2");
  });

  it("calls onCloseTab with the session id when the tab close button is clicked", () => {
    renderFlyout();
    fireEvent.click(screen.getByRole("button", { name: "Close Fix auth bug" }));
    expect(onCloseTab).toHaveBeenCalledWith("ses-1");
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("does not call onSelectSession when the tab close button is clicked", () => {
    renderFlyout();
    fireEvent.click(
      screen.getByRole("button", { name: "Close Add pagination" }),
    );
    expect(onSelectSession).not.toHaveBeenCalled();
  });

  it("calls onClose when the main close button is clicked", () => {
    renderFlyout();
    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    renderFlyout();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders the terminal for the active session", () => {
    renderFlyout("ses-2");
    expect(screen.getByTestId("terminal-ses-2")).toBeInTheDocument();
  });

  it("falls back to Untitled for sessions without a title", () => {
    const unnamed: FlyoutSession[] = [
      { sessionId: "ses-3", taskId: "t-3", title: "" },
    ];
    render(
      <TerminalFlyout
        sessions={unnamed}
        activeSessionId="ses-3"
        onSelectSession={onSelectSession}
        onCloseTab={onCloseTab}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });
});
