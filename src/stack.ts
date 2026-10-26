import { formatWord, type DisplayFormat } from "./format";

/** Word rows in the stack pane. High addresses are at the top, so a push moves SP down. */
export const STACK_WORD_COUNT = 8;

const HEADROOM_WORDS = 3;
const EDGE = 1;

const PAIRS = new Set(["BC", "DE", "HL", "AF", "IX", "IY"]);

export interface StackWord {
  source: string;
  dest?: string;
}

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
    const index = wordIndex(top, pointer);
    if (index !== undefined && index >= EDGE && index < STACK_WORD_COUNT - EDGE) {
      return top & 0xffff;
    }
  }
  return (pointer + HEADROOM_WORDS * 2) & 0xffff;
}

export function stackWordBases(top: number): number[] {
  const origin = top & 0xffff;
  return Array.from({ length: STACK_WORD_COUNT }, (_, index) => (origin - index * 2) & 0xffff);
}

/** High byte then low byte, the same order as a register pair. */
export function stackWordValue(low: number, high: number): number {
  return ((high & 0xff) << 8) | (low & 0xff);
}

export function formatStackLabel(word: StackWord | undefined): string {
  if (word === undefined) {
    return "";
  }
  if (word.dest !== undefined && word.dest !== "") {
    return `${word.source} → ${word.dest}`;
  }
  return word.source;
}

/**
 * Remember which instruction wrote each stack word.
 * The note stays on those two bytes until a later write replaces them.
 * A pop or return adds where the word went, and that note remains too.
 */
export function recordStackStep(
  notes: Map<number, StackWord>,
  touched: Set<number>,
  mnemonic: string,
  spBefore: number,
  spAfter: number,
  writes: readonly StackWrite[],
): void {
  touched.clear();
  const compact = mnemonic.replace(/\s+/g, "").toUpperCase();
  const before = spBefore & 0xffff;
  const after = spAfter & 0xffff;
  const push = /^PUSH(BC|DE|HL|AF|IX|IY)$/.exec(compact);
  const pop = /^POP(BC|DE|HL|AF|IX|IY)$/.exec(compact);
  const call = /^CALL\b/.test(mnemonic.trim().toUpperCase()) || /^RST\b/.test(mnemonic.trim().toUpperCase());
  const ret = /^RET\b/.test(mnemonic.trim().toUpperCase());

  if (push !== null && stackDrop(before, after) === 2 && PAIRS.has(push[1])) {
    notes.set(after, { source: push[1] });
    touched.add(after);
    retireOverlaps(notes, touched, writes, after);
    return;
  }
  if (call && stackDrop(before, after) === 2) {
    notes.set(after, { source: "return" });
    touched.add(after);
    retireOverlaps(notes, touched, writes, after);
    return;
  }
  if (pop !== null && stackLift(before, after) === 2 && PAIRS.has(pop[1])) {
    const existing = notes.get(before);
    notes.set(before, { source: existing?.source ?? "data", dest: pop[1] });
    touched.add(before);
    return;
  }
  if (ret && stackLift(before, after) === 2) {
    const existing = notes.get(before);
    notes.set(before, { source: existing?.source ?? "return", dest: "PC" });
    touched.add(before);
    return;
  }
  markDataWrites(notes, touched, writes);
}

export function paintStackPane(
  dump: HTMLElement,
  spHost: HTMLElement,
  state: { top: number | undefined },
  machine: {
    memory: Uint8Array;
    writes: readonly StackWrite[];
    sp: number;
    stackWords: ReadonlyMap<number, StackWord>;
    stackTouched: ReadonlySet<number>;
  },
  format: DisplayFormat,
): void {
  const sp = machine.sp & 0xffff;
  state.top = placeStackWindow(state.top, sp);
  spHost.replaceChildren(registerCell("SP", formatWord(sp, format)));
  dump.replaceChildren();
  const written = new Set(machine.writes.map((write) => write.address & 0xffff));
  for (const address of stackWordBases(state.top)) {
    dump.append(stackWordRow(address, sp, machine, written, format));
  }
}

function stackDrop(before: number, after: number): number {
  return (before - after) & 0xffff;
}

function stackLift(before: number, after: number): number {
  return (after - before) & 0xffff;
}

function retireOverlaps(
  notes: Map<number, StackWord>,
  touched: Set<number>,
  writes: readonly StackWrite[],
  keep: number,
): void {
  for (const write of writes) {
    const addr = write.address & 0xffff;
    const low = (addr - 1) & 0xffff;
    if (addr !== keep && notes.has(addr)) {
      notes.set(addr, { source: "data" });
      touched.add(addr);
    }
    if (low !== keep && notes.has(low)) {
      notes.set(low, { source: "data" });
      touched.add(low);
    }
  }
}

function markDataWrites(
  notes: Map<number, StackWord>,
  touched: Set<number>,
  writes: readonly StackWrite[],
): void {
  const addresses = new Set(writes.map((write) => write.address & 0xffff));
  for (const addr of addresses) {
    if (notes.has(addr)) {
      notes.set(addr, { source: "data" });
      touched.add(addr);
    }
    const low = (addr - 1) & 0xffff;
    if (notes.has(low)) {
      notes.set(low, { source: "data" });
      touched.add(low);
    }
  }
  for (const addr of addresses) {
    if (!addresses.has((addr + 1) & 0xffff) || notes.has(addr)) {
      continue;
    }
    notes.set(addr, { source: "data" });
    touched.add(addr);
  }
}

function wordIndex(top: number, sp: number): number | undefined {
  const distance = (top - sp) & 0xffff;
  if ((distance & 1) !== 0 || distance / 2 >= STACK_WORD_COUNT) {
    return undefined;
  }
  return distance / 2;
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

function stackWordRow(
  address: number,
  sp: number,
  machine: {
    memory: Uint8Array;
    stackWords: ReadonlyMap<number, StackWord>;
    stackTouched: ReadonlySet<number>;
  },
  written: ReadonlySet<number>,
  format: DisplayFormat,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "stack-row";
  const top = address === sp;
  const high = (address + 1) & 0xffff;
  const value = stackWordValue(machine.memory[address] ?? 0, machine.memory[high] ?? 0);
  const label = formatStackLabel(machine.stackWords.get(address));
  const changed = machine.stackTouched.has(address) || written.has(address) || written.has(high);
  if (top) {
    row.dataset.stackTop = "true";
  }
  const mark = document.createElement("span");
  mark.className = top ? "stack-mark current" : "stack-mark";
  if (top) {
    mark.textContent = "▶ SP";
    mark.setAttribute("role", "img");
    mark.setAttribute("aria-label", "Top of stack. SP holds this word.");
  } else {
    mark.setAttribute("aria-hidden", "true");
  }
  const addr = document.createElement("span");
  addr.className = "num addr";
  addr.textContent = formatWord(address, format);
  const cell = document.createElement("span");
  cell.className = changed ? "num word mem-byte changed" : "num word mem-byte";
  cell.dataset.addr = String(address);
  cell.textContent = formatWord(value, format);
  const note = document.createElement("span");
  note.className = "stack-note";
  note.dataset.label = label;
  note.textContent = label;
  row.append(mark, addr, cell, note);
  return row;
}
