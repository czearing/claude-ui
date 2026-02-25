import type { Meta, StoryObj } from "@storybook/react";

import { StatusIndicator } from "./StatusIndicator";

const meta: Meta<typeof StatusIndicator> = {
  title: "Components/StatusIndicator",
  component: StatusIndicator,
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#0d1117" }],
    },
  },
};

export default meta;

type Story = StoryObj<typeof StatusIndicator>;

export const Connecting: Story = {
  args: { status: "connecting" },
};

export const Thinking: Story = {
  args: { status: "thinking" },
};

export const Typing: Story = {
  args: { status: "typing" },
};

export const Waiting: Story = {
  args: { status: "waiting" },
};

export const Exited: Story = {
  args: { status: "exited" },
};

export const Disconnected: Story = {
  args: { status: "disconnected" },
};
