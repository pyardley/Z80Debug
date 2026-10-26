// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dragMemory,
  dragSource,
  FIRST_CENTER_PX,
  FIRST_MEMORY_PX,
  FIRST_SOURCE_PX,
  fitPanes,
  hexByteCount,
  loadPaneWidths,
  MIN_CENTER_PX,
  MIN_MEMORY_PX,
  MIN_SOURCE_PX,
  PANE_STORAGE_KEY,
  readPaneWidths,
  writePaneWidths,
} from "./panes";
import { mount } from "./ui";

const first = { source: FIRST_SOURCE_PX, center: FIRST_CENTER_PX, memory: FIRST_MEMORY_PX };

describe("pane widths", () => {
  it("starts with a short source, a comfortable center, and room for 16 hex bytes", () => {
    expect(first).toEqual({ source: 340, center: 480, memory: 520 });
  });

  it("gives leftover width to the center and keeps the source and memory", () => {
    expect(fitPanes(1600, first)).toEqual({ source: 340, center: 740, memory: 520 });
  });

  it("shrinks memory before the source when the center would be cramped", () => {
    const fitted = fitPanes(340 + 520 + 400, first);
    expect(fitted.center).toBe(MIN_CENTER_PX);
    expect(fitted.source).toBe(FIRST_SOURCE_PX);
    expect(fitted.memory).toBe(400 + 520 - MIN_CENTER_PX);
    expect(fitted.memory).toBeGreaterThanOrEqual(MIN_MEMORY_PX);
  });

  it("shrinks the source after memory is at its minimum, and stops at the source minimum", () => {
    const available = MIN_SOURCE_PX + MIN_CENTER_PX + MIN_MEMORY_PX - 30;
    const fitted = fitPanes(available, first);
    expect(fitted.memory).toBe(MIN_MEMORY_PX);
    expect(fitted.source).toBe(MIN_SOURCE_PX);
    expect(fitted.center).toBe(MIN_CENTER_PX - 30);
  });

  it("keeps the preferred widths when the page has not been measured", () => {
    expect(fitPanes(0, first)).toEqual(first);
  });

  it("drags the source split without moving memory", () => {
    const start = { source: 340, center: 600, memory: 520 };
    expect(dragSource(start, 40)).toEqual({ source: 380, center: 560, memory: 520 });
    expect(dragSource(start, -1000).source).toBe(MIN_SOURCE_PX);
    expect(dragSource(start, 1000).center).toBe(MIN_CENTER_PX);
  });

  it("drags the memory split without moving the source", () => {
    const start = { source: 340, center: 600, memory: 520 };
    expect(dragMemory(start, 40)).toEqual({ source: 340, center: 640, memory: 480 });
    expect(dragMemory(start, -1000)).toEqual({
      source: 340,
      center: MIN_CENTER_PX,
      memory: 520 + (600 - MIN_CENTER_PX),
    });
    expect(dragMemory(start, 1000).memory).toBe(MIN_MEMORY_PX);
  });

  it("uses 16 hex bytes when the row fits and 8 when it does not", () => {
    expect(hexByteCount(500, 477)).toBe(16);
    expect(hexByteCount(477, 477)).toBe(16);
    expect(hexByteCount(476, 477)).toBe(8);
    expect(hexByteCount(0, 477)).toBe(16);
    expect(hexByteCount(400, 0)).toBe(16);
    expect(hexByteCount(480, 477, 8)).toBe(8);
    expect(hexByteCount(489, 477, 8)).toBe(16);
  });
});

describe("pane width storage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the first layout when nothing is stored", () => {
    const storage = { getItem: () => null };
    expect(loadPaneWidths(storage)).toEqual(first);
  });

  it("remembers a saved layout", () => {
    const saved = { source: 360, center: 640, memory: 500 };
    let raw: string | null = null;
    const storage = {
      getItem: () => raw,
      setItem: (_key: string, value: string) => {
        raw = value;
      },
    };
    writePaneWidths(storage, saved);
    expect(JSON.parse(raw ?? "")).toEqual(saved);
    expect(loadPaneWidths(storage)).toEqual(saved);
  });

  it("uses the first layout when the stored value is unusable", () => {
    expect(loadPaneWidths({ getItem: () => "nope" })).toEqual(first);
    expect(loadPaneWidths({ getItem: () => "{\"source\":10}" })).toEqual(first);
  });

  it("uses the first layout when storage throws", () => {
    const storage = {
      getItem: () => {
        throw new DOMException("The operation is insecure.");
      },
      setItem: () => {
        throw new DOMException("The operation is insecure.");
      },
    };
    expect(readPaneWidths(storage)).toEqual(first);
    expect(() => writePaneWidths(storage, first)).not.toThrow();
  });
});

describe("pane splits on the page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("puts a separator between source and registers, and before memory", () => {
    window.happyDOM.setInnerWidth(1440);
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const source = root.querySelector(".split-source");
    const memory = root.querySelector(".split-memory");
    expect(source?.getAttribute("role")).toBe("separator");
    expect(memory?.getAttribute("aria-label")).toBe("Resize memory");
    expect(source?.parentElement).toBe(root.querySelector(".workspace"));
    expect(memory?.parentElement).toBe(root.querySelector(".bench"));
    expect(root.querySelector(".bench > .memory-pane")).not.toBeNull();
    expect(root.querySelector(".editor-pane")?.getAttribute("style")).toContain("340px");
    expect(root.querySelector(".memory-pane")?.getAttribute("style")).toContain("520px");
  });
});
