import { formatByte, formatWord, type DisplayFormat } from "./format";

/** Rows in the stack pane. High addresses are at the top, so a push moves SP down. */
export const STACK_ROW_COUNT = 12;

const HEADROOM = 4;
const EDGE = 2;

export interface StackWrite {
  address: number;
}

/**
 * Keep the same window while SP moves by a push or a pop.
 * A jump such as LD SP,nn picks a new window with room above and below SP.
 */
export function placeStackWindow(top: number | undefined, sp: number): number {
  const pointer = sp & 0xffff;
  if (top !== undefined) {
    const index = rowIndex(top, pointer);
    if (index !== undefined && index >= EDGE && index < STACK_ROW_COUNT - EDGE) {
      return top & 0xffff;
    }
  }
  return (pointer + HEADROOM) & 0xffff;
}

export function stackAddresses(top: number): number[] {
  const origin = top & 0xffff;
  return Array.from({ length: STACK_ROW_COUNT }, (_, index) => (origin - index) & 0xffff);
}

export function paintStackPane(
  dump: HTMLElement,
  spHost: HTMLElement,
  state: { top: number | undefined },
  machine: { memory: Uint8Array; writes: readonly StackWrite[]; sp: number },
  format: DisplayFormat,
): void {
  const sp = machine.sp & 0xffff;
  state.top = placeStackWindow(state.top, sp);
  spHost.replaceChildren(registerCell("SP", formatWord(sp, format)));
  dump.replaceChildren();
  const written = new Set(machine.writes.map((write) => write.address & 0xffff));
  for (const address of stackAddresses(state.top)) {
    dump.append(stackRow(address, sp, machine.memory[address] ?? 0, written.has(address), format));
  }
}

function rowIndex(top: number, sp: number): number | undefined {
  for (let index = 0; index < STACK_ROW_COUNT; index += 1) {
    if (((top - index) & 0xffff) === sp) {
      return index;
    }
  }
  return undefined;
}

function registerCell(label: string, text: string): HTMLElement {
  const cell = document.createElement("span");
  cell.className = "reg";
  const name = document.createElement("span");
  name.className = "reg-name";
  name.textContent = label;
  const value = document.createElement("span");
  value.className = "num word";
  value.dataset.key = "sp";
  value.textContent = text;
  cell.append(name, value);
  return cell;
}

function stackRow(
  address: number,
  sp: number,
  value: number,
  changed: boolean,
  format: DisplayFormat,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "stack-row";
  const top = address === sp;
  const high = address === ((sp + 1) & 0xffff);
  if (top) {
    row.dataset.stackTop = "true";
  }
  const mark = document.createElement("span");
  mark.className = top ? "stack-mark current" : "stack-mark";
  if (top) {
    mark.textContent = "▶ SP";
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", "Top of stack. SP holds this address, the low byte of the top word.");
  } else {
    mark.setAttribute("aria-hidden", "true");
  }
  const addr = document.createElement("span");
  addr.className = "num addr";
  addr.textContent = formatWord(address, format);
  const cell = document.createElement("span");
  cell.className = changed ? "num mem-byte changed" : "num mem-byte";
  cell.dataset.addr = String(address);
  cell.textContent = formatByte(value, format);
  const note = document.createElement("span");
  note.className = "stack-note";
  if (top) {
    note.textContent = "Top of stack, low byte";
  } else if (high) {
    note.textContent = "High byte";
  }
  row.append(mark, addr, cell, note);
  return row;
}
