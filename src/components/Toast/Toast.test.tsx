import { act, render, screen, waitFor } from "@testing-library/react";

import { toast, Toaster } from "./Toast";

function setup() {
  render(<Toaster />);
}

describe("Toaster", () => {
  it("renders a live region for screen reader announcements", () => {
    setup();
    // Sonner always renders a section with aria-live="polite" regardless of toast state
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  it("renders the toaster list in bottom-right position when a toast is shown", async () => {
    setup();
    act(() => {
      toast.message("Position test");
    });
    const toaster = await waitFor(() => {
      const el = document.querySelector("[data-sonner-toaster]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(toaster).toHaveAttribute("data-x-position", "right");
    expect(toaster).toHaveAttribute("data-y-position", "bottom");
  });

  it("renders the toaster list in top-center position when a toast is shown", async () => {
    render(<Toaster position="top-center" />);
    act(() => {
      toast.message("Position test top");
    });
    const toaster = await waitFor(() => {
      const el = document.querySelector("[data-sonner-toaster]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(toaster).toHaveAttribute("data-x-position", "center");
    expect(toaster).toHaveAttribute("data-y-position", "top");
  });
});

describe("toast", () => {
  beforeEach(() => {
    setup();
  });

  it("shows a success toast", async () => {
    act(() => {
      toast.success("Task completed");
    });
    expect(await screen.findByText("Task completed")).toBeInTheDocument();
  });

  it("shows an error toast", async () => {
    act(() => {
      toast.error("Something went wrong");
    });
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows a warning toast", async () => {
    act(() => {
      toast.warning("Disk space low");
    });
    expect(await screen.findByText("Disk space low")).toBeInTheDocument();
  });

  it("shows an info toast", async () => {
    act(() => {
      toast.info("New version available");
    });
    expect(
      await screen.findByText("New version available"),
    ).toBeInTheDocument();
  });

  it("shows a default message toast", async () => {
    act(() => {
      toast.message("Hello world");
    });
    expect(await screen.findByText("Hello world")).toBeInTheDocument();
  });

  it("shows a toast with a description", async () => {
    act(() => {
      toast.success("Saved", { description: "Your changes have been saved." });
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(
      await screen.findByText("Your changes have been saved."),
    ).toBeInTheDocument();
  });

  it("marks a dismissed toast as removed", async () => {
    let id: string | number;
    act(() => {
      id = toast.success("Temporary");
    });
    expect(await screen.findByText("Temporary")).toBeInTheDocument();

    act(() => {
      toast.dismiss(id);
    });

    // Sonner sets data-removed="true" when a toast is dismissed; DOM removal
    // happens after the CSS exit animation which does not run in jsdom.
    await waitFor(() => {
      const toastEl = document.querySelector(
        `[data-sonner-toast][data-removed="true"]`,
      );
      expect(toastEl).not.toBeNull();
    });
  });
});
