import type { Terminal as XTerm } from "@xterm/xterm";

export type TerminalPageState = {
  xterm: XTerm | null;
};
