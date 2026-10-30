// Shared column widths for the plain page and the toy page.
// The center pane takes leftover space. Source and memory stay at these starting widths.
// A saved layout replaces them.

export const PANE_STORAGE_KEY = "z80debug.paneWidths";

/** Opening source width. A saved layout replaces it. */
export const FIRST_SOURCE_PX = 471;
/** Opening center width. A measured window gives the leftover to the center instead. */
export const FIRST_CENTER_PX = 795;
/** Opening memory width. A saved layout replaces it. */
export const FIRST_MEMORY_PX = 539;

export const MIN_SOURCE_PX = 240;
export const MIN_CENTER_PX = 420;
/** Wide enough for a complete 8-byte row: address, 8 hex bytes, 8 ASCII. */
export const MIN_MEMORY_PX = 320;

const MAX_PANE_PX = 4000;

export type PaneWidths = {
  source: number;
  center: number;
  memory: number;
};

export function firstPaneWidths(): PaneWidths {
  return {
    source: FIRST_SOURCE_PX,
    center: FIRST_CENTER_PX,
    memory: FIRST_MEMORY_PX,
  };
}

export function loadPaneWidths(storage: Pick<Storage, "getItem">): PaneWidths {
  const raw = storage.getItem(PANE_STORAGE_KEY);
  if (raw === null || raw === "") {
    return firstPaneWidths();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return firstPaneWidths();
  }
  if (!isPaneWidths(parsed)) {
    return firstPaneWidths();
  }
  return sanitize(parsed);
}

export function savePaneWidths(storage: Pick<Storage, "setItem">, widths: PaneWidths): void {
  storage.setItem(PANE_STORAGE_KEY, JSON.stringify(sanitize(widths)));
}

export function readPaneWidths(storage: Pick<Storage, "getItem"> | null): PaneWidths {
  if (storage === null) {
    return firstPaneWidths();
  }
  try {
    return loadPaneWidths(storage);
  } catch {
    return firstPaneWidths();
  }
}

export function writePaneWidths(storage: Pick<Storage, "setItem"> | null, widths: PaneWidths): void {
  if (storage === null) {
    return;
  }
  try {
    savePaneWidths(storage, widths);
  } catch {
    // Private mode and Safari opened from a file can throw. Keep the widths already on screen.
  }
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Fit source, center, and memory into `available` pixels (the three panes, splitters already removed).
 * Source and memory stay at the preferred widths. Extra space goes to the center.
 * When the center would fall below its minimum, memory gives up width first, then the source.
 * An unmeasured page (`available` <= 0) keeps the preferred widths.
 */
export function fitPanes(available: number, preferred: PaneWidths): PaneWidths {
  const source = clamp(preferred.source, MIN_SOURCE_PX, MAX_PANE_PX);
  const memory = clamp(preferred.memory, MIN_MEMORY_PX, MAX_PANE_PX);
  if (!(available > 0)) {
    return {
      source,
      center: clamp(preferred.center, MIN_CENTER_PX, MAX_PANE_PX),
      memory,
    };
  }
  let nextSource = source;
  let nextMemory = memory;
  let center = available - nextSource - nextMemory;
  if (center < MIN_CENTER_PX) {
    let deficit = MIN_CENTER_PX - center;
    const fromMemory = Math.min(deficit, nextMemory - MIN_MEMORY_PX);
    nextMemory -= fromMemory;
    deficit -= fromMemory;
    const fromSource = Math.min(deficit, nextSource - MIN_SOURCE_PX);
    nextSource -= fromSource;
    center = available - nextSource - nextMemory;
  }
  return {
    source: nextSource,
    center: Math.max(0, center),
    memory: nextMemory,
  };
}

/** Positive `dx` widens the source and narrows the center. Memory stays put. */
export function dragSource(start: PaneWidths, dx: number): PaneWidths {
  const maxSource = start.source + Math.max(0, start.center - MIN_CENTER_PX);
  const source = clamp(Math.round(start.source + dx), MIN_SOURCE_PX, maxSource);
  return {
    source,
    center: start.center - (source - start.source),
    memory: start.memory,
  };
}

/** Positive `dx` narrows memory and widens the center. Source stays put. */
export function dragMemory(start: PaneWidths, dx: number): PaneWidths {
  const maxMemory = start.memory + Math.max(0, start.center - MIN_CENTER_PX);
  const memory = clamp(Math.round(start.memory - dx), MIN_MEMORY_PX, maxMemory);
  return {
    source: start.source,
    center: start.center + (start.memory - memory),
    memory,
  };
}

/**
 * 16 hex bytes when that row fits in `available` pixels, otherwise 8.
 * An unmeasured pane (no layout yet) stays on 16 so the first paint matches a wide window.
 * Once 8 is showing, the pane must clear the row by a few pixels before 16 returns,
 * so a scrollbar cannot flip the choice back and forth.
 */
export function hexByteCount(available: number, rowOf16: number, showing: 8 | 16 = 16): 8 | 16 {
  if (!(available > 0) || !(rowOf16 > 0)) {
    return 16;
  }
  if (showing === 8) {
    return rowOf16 + 12 <= available ? 16 : 8;
  }
  return rowOf16 <= available ? 16 : 8;
}

/** Width of an address, 16 hex bytes, and 16 ASCII characters, using the dump's own fonts. */
export function measureHexDump(host: HTMLElement): number {
  const row = document.createElement("div");
  row.className = "dump-row";
  row.style.position = "absolute";
  row.style.left = "0";
  row.style.top = "0";
  row.style.width = "max-content";
  row.style.visibility = "hidden";
  row.style.pointerEvents = "none";
  const addr = document.createElement("span");
  addr.className = "num addr";
  addr.textContent = "PC FFFF";
  const bytes = document.createElement("span");
  bytes.className = "bytes";
  for (let index = 0; index < 16; index += 1) {
    const cell = document.createElement("span");
    cell.className = "num mem-byte";
    cell.textContent = "00";
    bytes.append(cell);
  }
  const ascii = document.createElement("span");
  ascii.className = "ascii";
  ascii.textContent = "................";
  row.append(addr, bytes, ascii);
  host.append(row);
  const width = Math.ceil(row.getBoundingClientRect().width);
  row.remove();
  return width;
}

export function hexColumns(host: HTMLElement, showing: 8 | 16 = 16): 8 | 16 {
  return hexByteCount(host.clientWidth, measureHexDump(host), showing);
}

export type PaneSplit = {
  detach: () => void;
};

/**
 * Drag handles between source and the center, and between the center group and memory.
 * `onLayout` runs after a drag or a window resize so memory rows can follow the pane.
 */
export function mountPanes(root: ParentNode, onLayout: () => void): PaneSplit {
  const desk = required(root, ".desk, .bench");
  const shell = required(root, ".toy, .bench-main");
  const workspace = required(root, ".workspace");
  const source = required(root, ".editor-pane");
  const center = required(root, ".cpu-pane");
  const memory = required(root, ".memory-pane");
  const sourceSplit = required(root, ".split-source");
  const memorySplit = required(root, ".split-memory");

  let preferred = readPaneWidths(browserStorage());
  let applied = preferred;
  const stacked = window.matchMedia("(max-width: 1100px)");

  const apply = (): void => {
    if (stacked.matches) {
      source.style.width = "";
      center.style.width = "";
      memory.style.width = "";
      return;
    }
    const available = measureAvailable();
    applied = fitPanes(available, preferred);
    source.style.width = `${applied.source}px`;
    memory.style.width = `${applied.memory}px`;
    center.style.width = "";
  };

  const measureAvailable = (): number => {
    const deskWidth = desk.clientWidth;
    if (deskWidth <= 0) {
      return 0;
    }
    const chrome = Math.max(0, shell.getBoundingClientRect().width - workspace.getBoundingClientRect().width);
    return deskWidth - memorySplit.offsetWidth - sourceSplit.offsetWidth - chrome;
  };

  apply();

  const onStacked = (): void => {
    apply();
    onLayout();
  };
  stacked.addEventListener("change", onStacked);

  const deskObserver = new ResizeObserver(() => {
    apply();
    onLayout();
  });
  deskObserver.observe(desk);

  const remember = (): void => {
    const measured = Math.round(center.getBoundingClientRect().width);
    if (measured > 0) {
      preferred = { ...preferred, center: measured };
    }
    writePaneWidths(browserStorage(), preferred);
  };

  const enabled = (): boolean => !stacked.matches;
  const stopSource = bindDrag(sourceSplit, (start, dx) => {
    preferred = dragSource(start, dx);
    apply();
    onLayout();
  }, remember, () => applied, enabled);

  const stopMemory = bindDrag(memorySplit, (start, dx) => {
    preferred = dragMemory(start, dx);
    apply();
    onLayout();
  }, remember, () => applied, enabled);

  return {
    detach: () => {
      stacked.removeEventListener("change", onStacked);
      deskObserver.disconnect();
      stopSource();
      stopMemory();
    },
  };
}

function bindDrag(
  handle: HTMLElement,
  move: (start: PaneWidths, dx: number) => void,
  end: () => void,
  current: () => PaneWidths,
  enabled: () => boolean,
): () => void {
  let startX = 0;
  let startWidths: PaneWidths | undefined;
  let dragging = false;

  const onMove = (event: PointerEvent): void => {
    if (!dragging || startWidths === undefined) {
      return;
    }
    move(startWidths, event.clientX - startX);
  };

  const onUp = (event: PointerEvent): void => {
    if (!dragging) {
      return;
    }
    dragging = false;
    handle.releasePointerCapture(event.pointerId);
    document.body.style.cursor = "";
    end();
  };

  const onDown = (event: PointerEvent): void => {
    if (!enabled() || event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startWidths = current();
    handle.setPointerCapture(event.pointerId);
    document.body.style.cursor = "col-resize";
  };

  const onKey = (event: KeyboardEvent): void => {
    if (!enabled()) {
      return;
    }
    const step = event.shiftKey ? 48 : 16;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const dx = event.key === "ArrowRight" ? step : -step;
    move(current(), dx);
    end();
  };

  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
  handle.addEventListener("keydown", onKey);
  return () => {
    handle.removeEventListener("pointerdown", onDown);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    handle.removeEventListener("keydown", onKey);
  };
}

function required(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`missing ${selector}`);
  }
  return found;
}

function isPaneWidths(value: unknown): value is PaneWidths {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return isPx(record.source) && isPx(record.center) && isPx(record.memory);
}

function isPx(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitize(widths: PaneWidths): PaneWidths {
  return {
    source: clamp(Math.round(widths.source), MIN_SOURCE_PX, MAX_PANE_PX),
    center: clamp(Math.round(widths.center), MIN_CENTER_PX, MAX_PANE_PX),
    memory: clamp(Math.round(widths.memory), MIN_MEMORY_PX, MAX_PANE_PX),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
