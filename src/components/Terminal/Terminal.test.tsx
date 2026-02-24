import { render, screen } from "@testing-library/react";

import { Terminal } from "./Terminal";

const mockFit = jest.fn();
const mockOpen = jest.fn();
const mockLoadAddon = jest.fn();
const mockDispose = jest.fn();
const mockOnData = jest.fn().mockReturnValue({ dispose: jest.fn() });
const mockOnResize = jest.fn().mockReturnValue({ dispose: jest.fn() });
const mockXterm = {
  open: mockOpen,
  loadAddon: mockLoadAddon,
  dispose: mockDispose,
  onData: mockOnData,
  onResize: mockOnResize,
  cols: 80,
  rows: 24,
};

jest.mock("@xterm/xterm", () => ({
  Terminal: jest.fn().mockImplementation(() => mockXterm),
}));

jest.mock("@xterm/addon-fit", () => ({
  FitAddon: jest.fn().mockImplementation(() => ({ fit: mockFit })),
}));

describe("Terminal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a container element", () => {
    const onReady = jest.fn();
    render(<Terminal onReady={onReady} />);

    expect(screen.getByTestId("terminal-container")).toBeInTheDocument();
  });

  it("calls onReady with the xterm instance after mount", () => {
    const onReady = jest.fn();
    render(<Terminal onReady={onReady} />);

    expect(onReady).toHaveBeenCalledWith(mockXterm);
  });

  it("opens xterm in the container element", () => {
    render(<Terminal onReady={jest.fn()} />);

    expect(mockOpen).toHaveBeenCalledWith(expect.any(HTMLElement));
  });

  it("calls fit after opening", () => {
    render(<Terminal onReady={jest.fn()} />);

    expect(mockFit).toHaveBeenCalled();
  });

  it("calls onReady with null and disposes xterm on unmount", () => {
    const onReady = jest.fn();
    const { unmount } = render(<Terminal onReady={onReady} />);

    unmount();

    expect(onReady).toHaveBeenLastCalledWith(null);
    expect(mockDispose).toHaveBeenCalled();
  });
});
