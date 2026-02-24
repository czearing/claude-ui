import type { Terminal as XTerm } from "@xterm/xterm";

export type TerminalProps = {
  onReady: (term: XTerm | null) => void;
};
