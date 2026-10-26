import type { Banks } from "./machine";
import { asciiGlyph, formatByte, formatWord, type DisplayFormat } from "./format";
import {
  MOTION_MS,
  SHIFT_MS,
  shiftTracks,
  type Anchor,
  type MotionPlan,
  type RegName,
  type ShiftMotion,
  type ShiftTrack,
  type Travel,
} from "./motion";

export interface BadgeLift {
  group: "af" | "exx";
  badges: HTMLElement[];
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const AF_REGS = new Set<RegName>(["a", "af"]);
const EXX_REGS = new Set<RegName>(["b", "c", "d", "e", "h", "l", "bc", "de", "hl"]);

export class MotionStage {
  private generation = 0;
  private animations: Animation[] = [];
  private timers: number[] = [];
  private nodes: HTMLElement[] = [];
  private hidden: HTMLElement[] = [];
  private complete: (() => void) | undefined;

  constructor(private readonly root: HTMLElement) {}

  finish(): void {
    this.generation += 1;
    this.complete = undefined;
    const animations = this.animations;
    this.animations = [];
    for (const animation of animations) {
      if (animation.playState === "running") {
        animation.cancel();
      }
    }
    for (const id of this.timers) {
      window.clearTimeout(id);
    }
    this.timers = [];
    for (const node of this.nodes) {
      node.remove();
    }
    this.nodes = [];
    for (const element of this.hidden) {
      element.style.visibility = "";
      element.style.opacity = "";
      element.style.transform = "";
    }
    this.hidden = [];
  }

  play(input: {
    plan: MotionPlan;
    format: DisplayFormat;
    banks: Banks;
    sourceRect?: Box;
    swap?: BadgeLift;
    stackMark?: { from: Box; live: HTMLElement };
    onSettled?: () => void;
  }): void {
    const generation = this.generation;
    const duration = input.plan.type === "shift" ? SHIFT_MS : MOTION_MS;
    let closed = false;
    this.complete = () => {
      if (closed || generation !== this.generation) {
        return;
      }
      closed = true;
      const settled = input.onSettled;
      this.finish();
      settled?.();
    };
    const safety = window.setTimeout(() => {
      this.complete?.();
    }, duration + 120);
    this.timers.push(safety);

    if (input.plan.type === "swap" && input.swap !== undefined) {
      this.flyBadges(input.swap);
    } else if (input.plan.type === "travel") {
      for (const move of input.plan.moves) {
        this.flyToken(move, input.format, input.banks, input.sourceRect);
      }
    } else if (input.plan.type === "shift") {
      this.flyShift(input.plan, input.banks);
    }
    if (input.stackMark !== undefined) {
      this.slideStack(input.stackMark.from, input.stackMark.live);
    }
  }

  private flyBadges(swap: BadgeLift): void {
    const live = new Map<string, HTMLElement>();
    for (const badge of Array.from(this.root.querySelectorAll<HTMLElement>(`[data-badge="${swap.group}"]`))) {
      const side = badge.dataset.side;
      if (side !== undefined) {
        live.set(side, badge);
      }
    }
    const main = live.get("main")?.getBoundingClientRect();
    const alt = live.get("alt")?.getBoundingClientRect();
    if (main === undefined || alt === undefined) {
      return;
    }
    for (const badge of live.values()) {
      badge.style.visibility = "hidden";
      this.hidden.push(badge);
    }
    const body = this.root.ownerDocument.body;
    for (const badge of swap.badges) {
      const side = badge.dataset.side;
      const from = side === "alt" ? alt : main;
      const to = side === "alt" ? main : alt;
      body.append(badge);
      this.nodes.push(badge);
      badge.style.width = `${from.width}px`;
      badge.style.height = `${from.height}px`;
      this.slide(badge, from, to, from.left <= to.left ? -26 : 26);
    }
  }

  private flyToken(
    move: Travel,
    format: DisplayFormat,
    banks: Banks,
    sourceRect: Box | undefined,
  ): void {
    const from = this.anchorBox(move.from, banks, sourceRect);
    const to = this.anchorBox(move.to, banks, sourceRect);
    if (from === undefined || to === undefined) {
      return;
    }
    this.dim(move.to, banks);
    if (move.to.type === "mem" && move.width === 16) {
      this.dim({ type: "mem", address: (move.to.address + 1) & 0xffff }, banks);
    }
    if (move.from.type === "reg" && move.from.name === "pc") {
      this.dim(move.from, banks);
    }
    if (move.pop) {
      const pop = this.root.querySelector<HTMLElement>("#console-pop");
      if (pop !== null) {
        pop.style.transform = "scale(0)";
        this.hidden.push(pop);
        this.animate(pop, [
          { transform: "scale(0)", opacity: 0 },
          { transform: "scale(1.35)", opacity: 1, offset: 0.72 },
          { transform: "scale(1)", opacity: 1 },
        ]);
      }
    }
    const token = this.root.ownerDocument.createElement("div");
    token.className = "travel-token";
    token.dataset.value = String(move.value);
    token.setAttribute("aria-hidden", "true");
    token.textContent = tokenText(move, format);
    this.root.ownerDocument.body.append(token);
    this.nodes.push(token);
    const width = token.offsetWidth || 36;
    const height = token.offsetHeight || 28;
    const start = center(from, width, height);
    const end = center(to, width, height);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2 - 36;
    this.animate(token, [
      { transform: `translate(${start.x}px, ${start.y}px) scale(1.15)` },
      { transform: `translate(${start.x}px, ${start.y - 14}px) scale(1.15)`, offset: 0.24 },
      { transform: `translate(${midX}px, ${midY}px) scale(1.08)`, offset: 0.62 },
      { transform: `translate(${end.x}px, ${end.y}px) scale(1)` },
    ]);
  }

  private flyShift(plan: ShiftMotion, banks: Banks): void {
    const box = this.anchorBox(plan.anchor, banks, undefined) ?? { left: 80, top: 180, width: 40, height: 28 };
    this.dim(plan.anchor, banks);
    const tracks = shiftTracks(plan.kind, plan.before, plan.carryBefore);
    const carryBox = boxOf(this.flagElement(banks, "c"));
    const bit = 28;
    const gap = 6;
    const rowWidth = 8 * bit + 7 * gap;
    const view = this.root.ownerDocument.defaultView;
    const viewWidth = view?.innerWidth || 1200;
    let rowLeft = box.left + box.width / 2 - rowWidth / 2;
    rowLeft = Math.max(8, Math.min(rowLeft, viewWidth - rowWidth - 8));
    let rowTop = box.top - bit - 16;
    if (rowTop < 8) {
      rowTop = box.top + box.height + 12;
    }
    const slotAt = (slot: number): { x: number; y: number } => ({
      x: rowLeft + slot * (bit + gap),
      y: rowTop,
    });
    const cellAt = {
      x: box.left + box.width / 2 - bit / 2,
      y: box.top + box.height / 2 - bit / 2,
    };
    const carryAt = carryBox === undefined
      ? { x: box.left + box.width + 48, y: box.top }
      : {
        x: carryBox.left + carryBox.width / 2 - bit / 2,
        y: carryBox.top + carryBox.height / 2 - bit / 2,
      };
    for (const track of tracks) {
      this.flyBit(track, cellAt, slotAt, carryAt);
    }
    const generation = this.generation;
    this.timers.push(window.setTimeout(() => {
      if (generation !== this.generation) {
        return;
      }
      this.showFlag(banks, "c", plan.carryAfter);
    }, Math.round(SHIFT_MS * 0.84)));
    if (plan.flagsFromResult) {
      this.timers.push(window.setTimeout(() => {
        if (generation !== this.generation) {
          return;
        }
        this.showFlag(banks, "s", plan.sign);
        this.showFlag(banks, "z", plan.zero);
        this.showFlag(banks, "pv", plan.parity);
      }, Math.round(SHIFT_MS * 0.92)));
    }
  }

  private flyBit(
    track: ShiftTrack,
    cellAt: { x: number; y: number },
    slotAt: (slot: number) => { x: number; y: number },
    carryAt: { x: number; y: number },
  ): void {
    const chip = this.root.ownerDocument.createElement("div");
    chip.className = "shift-bit";
    chip.dataset.value = String(track.value);
    chip.dataset.from = track.from;
    chip.dataset.to = track.to;
    if (track.fromSlot !== undefined) {
      chip.dataset.fromSlot = String(track.fromSlot);
    }
    if (track.toSlot !== undefined) {
      chip.dataset.toSlot = String(track.toSlot);
    }
    chip.textContent = String(track.value);
    chip.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(chip);
    this.nodes.push(chip);
    const end = track.to === "carry" ? carryAt : slotAt(track.toSlot ?? 0);
    const home = track.from === "bit" ? slotAt(track.fromSlot ?? 0) : track.from === "carry" ? carryAt : end;
    const frames = track.from === "fill"
      ? [
        { transform: `translate(${end.x}px, ${end.y}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${end.x}px, ${end.y}px) scale(0.4)`, opacity: 0, offset: 0.42 },
        { transform: `translate(${end.x}px, ${end.y}px) scale(1.12)`, opacity: 1, offset: 0.7 },
        { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1 },
      ]
      : track.from === "carry"
        ? [
          { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 1 },
          { transform: `translate(${home.x}px, ${home.y - 10}px) scale(1.05)`, offset: 0.4 },
          { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, offset: 0.78 },
          { transform: `translate(${end.x}px, ${end.y}px) scale(1)` },
        ]
        : [
          { transform: `translate(${cellAt.x}px, ${cellAt.y}px) scale(0.45)`, opacity: 0.2 },
          { transform: `translate(${home.x}px, ${home.y}px) scale(1.06)`, opacity: 1, offset: 0.28 },
          { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 1, offset: 0.42 },
          { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1, offset: track.to === "carry" ? 0.86 : 0.74 },
          { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1 },
        ];
    this.animate(chip, frames, SHIFT_MS, "linear");
  }

  private showFlag(banks: Banks, key: string, on: boolean): void {
    const element = this.flagElement(banks, key);
    if (element === null) {
      return;
    }
    const was = element.dataset.set === "1";
    element.dataset.set = on ? "1" : "0";
    element.classList.toggle("set", on);
    if (was !== on) {
      element.classList.add("changed");
    }
  }

  private flagElement(banks: Banks, key: string): HTMLElement | null {
    const side = banks.main.afActive ? "main" : "alt";
    return this.root.querySelector<HTMLElement>(`[data-side="${side}"][data-flag="${key}"]`);
  }

  private dim(anchor: Anchor, banks: Banks): void {
    if (anchor.type === "source" || anchor.type === "console") {
      return;
    }
    const elements = anchor.type === "mem"
      ? Array.from(this.root.querySelectorAll<HTMLElement>(`[data-addr="${anchor.address}"]`))
      : [this.anchorElement(anchor, banks)].filter((element): element is HTMLElement => element !== null);
    for (const element of elements) {
      element.style.opacity = "0";
      this.hidden.push(element);
    }
  }

  private anchorBox(anchor: Anchor, banks: Banks, sourceRect: Box | undefined): Box | undefined {
    if (anchor.type === "source") {
      return sourceRect ?? boxOf(this.root.querySelector("#source-scroll"));
    }
    if (anchor.type === "console") {
      return boxOf(this.root.querySelector("#console-pop"))
        ?? boxOf(this.root.querySelector("#console-waiting"))
        ?? boxOf(this.root.querySelector("#console-output"));
    }
    return boxOf(this.anchorElement(anchor, banks));
  }

  private anchorElement(anchor: Anchor, banks: Banks): HTMLElement | null {
    if (anchor.type === "reg") {
      const key = regKey(anchor.name, banks);
      if (key === undefined) {
        return null;
      }
      return this.root.querySelector<HTMLElement>(`[data-key="${key}"]`);
    }
    if (anchor.type === "mem") {
      const selector = `[data-addr="${anchor.address}"]`;
      return this.root.querySelector<HTMLElement>(`#memory-stack ${selector}`)
        ?? this.root.querySelector<HTMLElement>(`#memory-focus ${selector}`)
        ?? this.root.querySelector<HTMLElement>(`#memory-pc ${selector}`)
        ?? this.root.querySelector<HTMLElement>("#memory-stack")
        ?? this.root.querySelector<HTMLElement>("#memory-focus");
    }
    return null;
  }

  private slideStack(from: Box, live: HTMLElement): void {
    const to = boxOf(live);
    if (to === undefined) {
      return;
    }
    live.style.visibility = "hidden";
    this.hidden.push(live);
    const clone = live.cloneNode(true) as HTMLElement;
    clone.classList.add("flying-stack-mark");
    clone.style.visibility = "visible";
    this.root.ownerDocument.body.append(clone);
    this.nodes.push(clone);
    this.slide(clone, from, to, from.top <= to.top ? 16 : -16);
  }

  private slide(element: HTMLElement, from: Box, to: Box, lift: number): void {
    const midX = (from.left + to.left) / 2;
    const midY = (from.top + to.top) / 2 + lift;
    this.animate(element, [
      { transform: `translate(${from.left}px, ${from.top}px)` },
      { transform: `translate(${from.left}px, ${from.top + lift * 0.35}px)`, offset: 0.2 },
      { transform: `translate(${midX}px, ${midY}px)`, offset: 0.58 },
      { transform: `translate(${to.left}px, ${to.top}px)` },
    ]);
  }

  private animate(
    element: HTMLElement,
    frames: Keyframe[],
    duration = MOTION_MS,
    easing = "cubic-bezier(0.2, 0.75, 0.2, 1)",
  ): void {
    if (typeof element.animate !== "function") {
      return;
    }
    const animation = element.animate(frames, {
      duration,
      easing,
      fill: "forwards",
    });
    this.animations.push(animation);
    const generation = this.generation;
    animation.onfinish = () => {
      if (generation !== this.generation) {
        return;
      }
      if (this.animations.every((item) => item.playState !== "running")) {
        this.complete?.();
      }
    };
  }
}

function regKey(name: RegName, banks: Banks): string | undefined {
  if (name === "sp" || name === "pc" || name === "ix" || name === "iy" || name === "i" || name === "r") {
    return name;
  }
  if (AF_REGS.has(name)) {
    return `${banks.main.afActive ? "main" : "alt"}.${name}`;
  }
  if (EXX_REGS.has(name)) {
    return `${banks.main.exxActive ? "main" : "alt"}.${name}`;
  }
  return undefined;
}

function boxOf(element: Element | null): Box | undefined {
  if (element === null) {
    return undefined;
  }
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function center(box: Box, width: number, height: number): { x: number; y: number } {
  return {
    x: box.left + box.width / 2 - width / 2,
    y: box.top + box.height / 2 - height / 2,
  };
}

function tokenText(move: Travel, format: DisplayFormat): string {
  const consoleMove = move.from.type === "console" || move.to.type === "console";
  if (consoleMove && move.value >= 0x20 && move.value <= 0x7e) {
    return asciiGlyph(move.value);
  }
  const value = move.width === 16 ? formatWord(move.value, format) : formatByte(move.value, format);
  return move.label === undefined || move.label === "" ? value : `${move.label} ${value.trim()}`;
}
