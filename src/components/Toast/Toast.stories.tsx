import type { Meta, StoryObj } from "@storybook/react";

import { toast, Toaster } from "./Toast";

const meta: Meta<typeof Toaster> = {
  title: "Components/Toast",
  component: Toaster,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#121214" }],
    },
  },
  decorators: [
    (Story) => (
      <>
        <Story />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => toast.success("Changes saved successfully")}>
            Show success
          </button>
          <button onClick={() => toast.error("Failed to connect to server")}>
            Show error
          </button>
          <button onClick={() => toast.warning("Disk space running low")}>
            Show warning
          </button>
          <button onClick={() => toast.info("A new version is available")}>
            Show info
          </button>
          <button onClick={() => toast.message("Background task started")}>
            Show default
          </button>
          <button
            onClick={() =>
              toast.success("Task complete", {
                description: "All 12 specs have been processed.",
              })
            }
          >
            Show with description
          </button>
          <button onClick={() => toast.loading("Cloning repository...")}>
            Show loading
          </button>
        </div>
      </>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof Toaster>;

export const Default: Story = {
  args: {
    position: "bottom-right",
    closeButton: true,
    expand: false,
    visibleToasts: 5,
  },
};

export const TopCenter: Story = {
  args: {
    position: "top-center",
    closeButton: true,
  },
};

export const Expanded: Story = {
  args: {
    position: "bottom-right",
    expand: true,
    closeButton: true,
  },
};
