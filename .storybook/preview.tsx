import type { Preview } from "@storybook/react";

import "../src/app/global.css";

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    layout: "fullscreen",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
