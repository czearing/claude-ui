import { render, screen } from "@testing-library/react";

import { StatusIndicator } from "./StatusIndicator";
import type { ClaudeStatus } from "./StatusIndicator.types";

const statuses: Array<{ status: ClaudeStatus; label: string }> = [
  { status: "connecting", label: "Connecting" },
  { status: "thinking", label: "Thinking" },
  { status: "typing", label: "Typing" },
  { status: "waiting", label: "Waiting" },
  { status: "exited", label: "Exited" },
  { status: "disconnected", label: "Disconnected" },
];

describe("StatusIndicator", () => {
  it("has role status", () => {
    render(<StatusIndicator status="waiting" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it.each(statuses)(
    "renders the correct label for status $status",
    ({ status, label }) => {
      render(<StatusIndicator status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it.each(statuses)(
    "has correct aria-label for status $status",
    ({ status, label }) => {
      render(<StatusIndicator status={status} />);
      expect(screen.getByRole("status")).toHaveAttribute(
        "aria-label",
        `Claude status: ${label}`,
      );
    },
  );

  it.each(statuses)(
    "applies the correct CSS class for status $status",
    ({ status }) => {
      render(<StatusIndicator status={status} />);
      const el = screen.getByRole("status");
      expect(el.className).toContain(status);
    },
  );
});
