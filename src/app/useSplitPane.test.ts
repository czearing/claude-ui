import { act, renderHook } from "@testing-library/react";

import { useSplitPane } from "./useSplitPane";

const STORAGE_KEY = "split-pane-left-width";
const DEFAULT_LEFT_WIDTH = 480;
const MIN_LEFT = 320;

beforeEach(() => {
  localStorage.clear();
});

describe("useSplitPane", () => {
  // ── initial state ─────────────────────────────────────────────────────────

  it("starts with the default left width", () => {
    const { result } = renderHook(() => useSplitPane());
    expect(result.current.leftWidth).toBe(DEFAULT_LEFT_WIDTH);
  });

  it("exposes contentRef, leftRef, openPane, and handleDividerMouseDown", () => {
    const { result } = renderHook(() => useSplitPane());
    expect(result.current.contentRef).toBeDefined();
    expect(result.current.leftRef).toBeDefined();
    expect(typeof result.current.openPane).toBe("function");
    expect(typeof result.current.handleDividerMouseDown).toBe("function");
  });

  // ── openPane with no stored width ─────────────────────────────────────────

  it("openPane sets leftWidth to the default when localStorage is empty", () => {
    const { result } = renderHook(() => useSplitPane());
    act(() => result.current.openPane());
    expect(result.current.leftWidth).toBe(DEFAULT_LEFT_WIDTH);
  });

  // ── openPane with a stored width ──────────────────────────────────────────

  it("openPane restores a previously stored width", () => {
    localStorage.setItem(STORAGE_KEY, "600");
    const { result } = renderHook(() => useSplitPane());
    act(() => result.current.openPane());
    expect(result.current.leftWidth).toBe(600);
  });

  it("openPane falls back to the default when the stored value is below MIN_LEFT", () => {
    localStorage.setItem(STORAGE_KEY, String(MIN_LEFT - 1));
    const { result } = renderHook(() => useSplitPane());
    act(() => result.current.openPane());
    expect(result.current.leftWidth).toBe(DEFAULT_LEFT_WIDTH);
  });

  it("openPane accepts a stored value equal to MIN_LEFT", () => {
    localStorage.setItem(STORAGE_KEY, String(MIN_LEFT));
    const { result } = renderHook(() => useSplitPane());
    act(() => result.current.openPane());
    expect(result.current.leftWidth).toBe(MIN_LEFT);
  });

  it("openPane falls back to the default when the stored value is NaN", () => {
    localStorage.setItem(STORAGE_KEY, "not-a-number");
    const { result } = renderHook(() => useSplitPane());
    act(() => result.current.openPane());
    expect(result.current.leftWidth).toBe(DEFAULT_LEFT_WIDTH);
  });

  it("openPane falls back to the default when the stored entry is an empty string", () => {
    localStorage.setItem(STORAGE_KEY, "");
    const { result } = renderHook(() => useSplitPane());
    act(() => result.current.openPane());
    expect(result.current.leftWidth).toBe(DEFAULT_LEFT_WIDTH);
  });

  // ── localStorage unavailable ──────────────────────────────────────────────

  it("openPane falls back to the default when localStorage throws", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("localStorage unavailable");
    });
    const { result } = renderHook(() => useSplitPane());
    act(() => result.current.openPane());
    expect(result.current.leftWidth).toBe(DEFAULT_LEFT_WIDTH);
    jest.restoreAllMocks();
  });

  // ── handleDividerMouseDown ────────────────────────────────────────────────
  // Tests for the resize drag: we simulate mousedown → mousemove → mouseup
  // by attaching real DOM elements to the refs and firing synthetic events.

  it("handleDividerMouseDown attaches mousemove/mouseup listeners and removes them on mouseup", () => {
    const addSpy = jest.spyOn(document, "addEventListener");
    const removeSpy = jest.spyOn(document, "removeEventListener");

    const { result } = renderHook(() => useSplitPane());

    // Attach DOM nodes to the refs so the handler can proceed
    const contentEl = document.createElement("div");
    const leftEl = document.createElement("div");
    (
      result.current.contentRef as React.MutableRefObject<HTMLDivElement>
    ).current = contentEl;
    (result.current.leftRef as React.MutableRefObject<HTMLDivElement>).current =
      leftEl;

    act(() => {
      result.current.handleDividerMouseDown({
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    expect(addSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));

    // Fire mouseup to clean up
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(removeSpy).toHaveBeenCalledWith("mousemove", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("mouseup", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("handleDividerMouseDown stores the final width in localStorage on mouseup", () => {
    const { result } = renderHook(() => useSplitPane());

    const contentEl = document.createElement("div");
    const leftEl = document.createElement("div");
    jest.spyOn(contentEl, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      bottom: 0,
      right: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    (
      result.current.contentRef as React.MutableRefObject<HTMLDivElement>
    ).current = contentEl;
    (result.current.leftRef as React.MutableRefObject<HTMLDivElement>).current =
      leftEl;

    act(() => {
      result.current.handleDividerMouseDown({
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    // Simulate dragging to x=550
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 550 }));
    });

    // Confirm leftEl.style.width was updated during drag
    expect(leftEl.style.width).toBe("550px");

    // Release
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("550");
    expect(result.current.leftWidth).toBe(550);
  });

  it("handleDividerMouseDown clamps width to MIN_LEFT when dragged too far left", () => {
    const { result } = renderHook(() => useSplitPane());

    const contentEl = document.createElement("div");
    const leftEl = document.createElement("div");
    jest.spyOn(contentEl, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 1000,
      top: 0,
      bottom: 0,
      right: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    (
      result.current.contentRef as React.MutableRefObject<HTMLDivElement>
    ).current = contentEl;
    (result.current.leftRef as React.MutableRefObject<HTMLDivElement>).current =
      leftEl;

    act(() => {
      result.current.handleDividerMouseDown({
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10 }));
    });

    // Should be clamped to MIN_LEFT
    expect(leftEl.style.width).toBe(`${MIN_LEFT}px`);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
  });

  it("handleDividerMouseDown does nothing when refs are not attached", () => {
    const addSpy = jest.spyOn(document, "addEventListener");
    const { result } = renderHook(() => useSplitPane());

    // Do NOT attach DOM nodes — refs remain null
    act(() => {
      result.current.handleDividerMouseDown({
        preventDefault: jest.fn(),
      } as unknown as React.MouseEvent);
    });

    expect(addSpy).not.toHaveBeenCalledWith("mousemove", expect.any(Function));
    addSpy.mockRestore();
  });
});
