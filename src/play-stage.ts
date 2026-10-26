import type { Banks } from "./machine";
import { asciiGlyph, formatByte, formatWord, type DisplayFormat } from "./format";
import {
  ALU_MS,
  BRANCH_MS,
  COUNTER_MS,
  DAA_MS,
  LOGIC_MS,
  MOTION_MS,
  NIBBLE_MS,
  SHIFT_MS,
  WORD_MS,
  counterDigits,
  logicRows,
  scaledMs,
  shiftTracks,
  type Anchor,
  type ArithMotion,
  type BranchMotion,
  type DaaMotion,
  type FlagPicture,
  type MotionPlan,
  type NibbleMotion,
  type RegName,
  type BitMotion,
  type CounterMotion,
  type LogicMotion,
  type ShiftMotion,
  type ShiftTrack,
  type Travel,
  type WordMotion,
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

interface Clock {
  remaining: number;
  started: number;
  id: number;
  live: boolean;
  fn: () => void;
}

export class MotionStage {
  private generation = 0;
  /** 1 keeps the built-in pace. Lower rates stretch every animation. */
  private rate = 1;
  /** The Pause button is down. The next picture starts frozen too. */
  private held = false;
  /** Animations and timers are currently stopped in place. */
  private frozen = false;
  private animations: Animation[] = [];
  private clocks: Clock[] = [];
  private nodes: HTMLElement[] = [];
  private hidden: HTMLElement[] = [];
  private complete: (() => void) | undefined;

  isHeld(): boolean {
    return this.held;
  }

  /** Freeze the picture that is on screen. Machine state is left alone. */
  pause(): void {
    if (this.held) {
      return;
    }
    this.held = true;
    this.freeze();
  }

  /** Continue the frozen picture from the frame where it stopped. */
  resume(): void {
    if (!this.held) {
      return;
    }
    this.held = false;
    this.thaw();
  }

  constructor(private readonly root: HTMLElement) {}

  finish(): void {
    this.generation += 1;
    this.complete = undefined;
    this.frozen = false;
    const animations = this.animations;
    this.animations = [];
    for (const animation of animations) {
      if (animation.playState === "running" || animation.playState === "paused") {
        animation.cancel();
      }
    }
    for (const clock of this.clocks) {
      clock.live = false;
      window.clearTimeout(clock.id);
    }
    this.clocks = [];
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
    rate?: number;
  }): void {
    const generation = this.generation;
    this.rate = input.rate ?? 1;
    const duration = this.scaled(planDuration(input.plan));
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
    this.later(duration + this.scaled(120), () => {
      this.complete?.();
    });

    if (input.plan.type === "swap" && input.swap !== undefined) {
      this.flyBadges(input.swap);
    } else if (input.plan.type === "travel") {
      for (const move of input.plan.moves) {
        this.flyToken(move, input.format, input.banks, input.sourceRect);
      }
    } else if (input.plan.type === "shift") {
      this.flyShift(input.plan, input.banks);
    } else if (input.plan.type === "bit") {
      this.flyBitOp(input.plan, input.banks);
    } else if (input.plan.type === "logic") {
      this.flyLogic(input.plan, input.format, input.banks, input.sourceRect);
    } else if (input.plan.type === "counter") {
      this.flyCounter(input.plan, input.format, input.banks);
    } else if (input.plan.type === "alu") {
      this.flyAlu(input.plan, input.format, input.banks, input.sourceRect);
    } else if (input.plan.type === "word") {
      this.flyWord(input.plan, input.format, input.banks);
    } else if (input.plan.type === "daa") {
      this.flyDaa(input.plan, input.format, input.banks);
    } else if (input.plan.type === "branch") {
      this.flyBranch(input.plan, input.format, input.banks);
    } else if (input.plan.type === "nibble") {
      this.flyNibble(input.plan, input.format, input.banks);
    }
    if (input.stackMark !== undefined) {
      this.slideStack(input.stackMark.from, input.stackMark.live);
    }
    if (this.held) {
      this.freeze();
    }
  }

  private later(delay: number, fn: () => void): void {
    const clock: Clock = { remaining: delay, started: 0, id: 0, live: true, fn };
    this.clocks.push(clock);
    this.arm(clock);
  }

  private arm(clock: Clock): void {
    clock.started = performance.now();
    clock.id = window.setTimeout(() => {
      if (!clock.live) {
        return;
      }
      clock.live = false;
      clock.fn();
    }, Math.max(0, clock.remaining));
  }

  private freeze(): void {
    if (this.frozen) {
      return;
    }
    this.frozen = true;
    const now = performance.now();
    for (const clock of this.clocks) {
      if (!clock.live) {
        continue;
      }
      window.clearTimeout(clock.id);
      clock.remaining = Math.max(0, clock.remaining - (now - clock.started));
    }
    for (const animation of this.animations) {
      if (animation.playState === "running") {
        animation.pause();
      }
    }
  }

  private thaw(): void {
    if (!this.frozen) {
      return;
    }
    this.frozen = false;
    for (const clock of this.clocks) {
      if (clock.live) {
        this.arm(clock);
      }
    }
    for (const animation of this.animations) {
      if (animation.playState === "paused") {
        animation.play();
      }
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
    this.later(this.scaled(SHIFT_MS * 0.84), () => {
      if (generation !== this.generation) {
        return;
      }
      this.showFlag(banks, "c", plan.carryAfter);
    });
    if (plan.flagsFromResult) {
      this.later(this.scaled(SHIFT_MS * 0.92), () => {
        if (generation !== this.generation) {
          return;
        }
        this.showFlag(banks, "s", plan.sign);
        this.showFlag(banks, "z", plan.zero);
        this.showFlag(banks, "pv", plan.parity);
      });
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

  private flyBitOp(plan: BitMotion, banks: Banks): void {
    const laid = this.bitLayout(plan.anchor, banks);
    this.dim(plan.anchor, banks);
    const chosen = 7 - plan.bit;
    const generation = this.generation;
    for (let slot = 0; slot < 8; slot++) {
      const value = ((plan.before >> (7 - slot)) & 1) as 0 | 1;
      const chip = this.makeBit(value);
      chip.dataset.from = "bit";
      chip.dataset.fromSlot = String(slot);
      chip.dataset.to = "bit";
      chip.dataset.toSlot = String(slot);
      chip.dataset.op = plan.op;
      chip.dataset.bit = String(plan.bit);
      const home = laid.slotAt(slot);
      const frames = [
        { transform: `translate(${laid.cellAt.x}px, ${laid.cellAt.y}px) scale(0.45)`, opacity: 0.2 },
        { transform: `translate(${home.x}px, ${home.y}px) scale(1.06)`, opacity: 1, offset: 0.28 },
        { transform: `translate(${home.x}px, ${home.y}px) scale(${slot === chosen ? 1.2 : 1})`, opacity: 1, offset: 0.55 },
        { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 1 },
      ];
      if (slot === chosen) {
        chip.classList.add("chosen");
        if (plan.op !== "bit") {
          const next: 0 | 1 = plan.op === "set" ? 1 : 0;
          this.later(this.scaled(SHIFT_MS * 0.5), () => {
            if (generation !== this.generation) {
              return;
            }
            chip.dataset.value = String(next);
            chip.textContent = String(next);
          });
        }
      }
      this.animate(chip, frames, SHIFT_MS, "linear");
    }
    if (plan.op !== "bit") {
      return;
    }
    const tested = ((plan.before >> plan.bit) & 1) as 0 | 1;
    const opposite: 0 | 1 = tested === 0 ? 1 : 0;
    const link = this.makeBit(opposite);
    link.dataset.from = "bit";
    link.dataset.fromSlot = String(chosen);
    link.dataset.to = "z";
    link.dataset.op = "bit";
    const zeroBox = boxOf(this.flagElement(banks, "z"));
    const zeroAt = zeroBox === undefined
      ? { x: laid.box.left + laid.box.width + 36, y: laid.box.top }
      : {
        x: zeroBox.left + zeroBox.width / 2 - 14,
        y: zeroBox.top + zeroBox.height / 2 - 14,
      };
    const home = laid.slotAt(chosen);
    this.animate(link, [
      { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 0 },
      { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 1, offset: 0.42 },
      { transform: `translate(${zeroAt.x}px, ${zeroAt.y}px) scale(1)`, opacity: 1, offset: 0.8 },
      { transform: `translate(${zeroAt.x}px, ${zeroAt.y}px) scale(1)`, opacity: 1 },
    ], SHIFT_MS, "linear");
    this.later(this.scaled(SHIFT_MS * 0.8), () => {
      if (generation !== this.generation) {
        return;
      }
      this.showFlag(banks, "z", plan.zeroAfter);
    });
  }

  private bitLayout(anchor: Anchor, banks: Banks): {
    box: Box;
    cellAt: { x: number; y: number };
    slotAt: (slot: number) => { x: number; y: number };
  } {
    const box = this.anchorBox(anchor, banks, undefined) ?? { left: 80, top: 180, width: 40, height: 28 };
    const bit = 28;
    const gap = 6;
    const rowWidth = 8 * bit + 7 * gap;
    const viewWidth = this.root.ownerDocument.defaultView?.innerWidth || 1200;
    let rowLeft = box.left + box.width / 2 - rowWidth / 2;
    rowLeft = Math.max(8, Math.min(rowLeft, viewWidth - rowWidth - 8));
    let rowTop = box.top - bit - 16;
    if (rowTop < 8) {
      rowTop = box.top + box.height + 12;
    }
    return {
      box,
      cellAt: {
        x: box.left + box.width / 2 - bit / 2,
        y: box.top + box.height / 2 - bit / 2,
      },
      slotAt: (slot: number) => ({
        x: rowLeft + slot * (bit + gap),
        y: rowTop,
      }),
    };
  }

  private makeBit(value: 0 | 1): HTMLDivElement {
    const chip = this.root.ownerDocument.createElement("div");
    chip.className = "shift-bit";
    chip.dataset.value = String(value);
    chip.textContent = String(value);
    chip.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(chip);
    this.nodes.push(chip);
    return chip;
  }

  private flyLogic(plan: LogicMotion, format: DisplayFormat, banks: Banks, sourceRect: Box | undefined): void {
    const rows = logicRows(plan.op, plan.left, plan.right);
    const destBox = this.anchorBox(plan.dest, banks, sourceRect) ?? { left: 80, top: 220, width: 40, height: 28 };
    const otherBox = this.anchorBox(plan.other, banks, sourceRect) ?? destBox;
    this.dim(plan.dest, banks);
    if (plan.other.type !== "source") {
      this.dim(plan.other, banks);
    }
    const bit = 28;
    const gap = 6;
    const rowWidth = 8 * bit + 7 * gap;
    const stackHeight = bit * 3 + gap * 2;
    const padX = 16;
    const padTop = 46;
    const padBottom = 14;
    const boardW = rowWidth + padX * 2;
    const boardH = stackHeight + padTop + padBottom;
    const view = this.root.ownerDocument.defaultView;
    const viewWidth = view?.innerWidth || 1200;
    const viewHeight = view?.innerHeight || 900;
    let boardLeft = destBox.left + destBox.width / 2 - boardW / 2;
    boardLeft = Math.max(12, Math.min(boardLeft, viewWidth - boardW - 12));
    let boardTop = destBox.top - boardH - 10;
    if (boardTop < 12) {
      boardTop = destBox.top + destBox.height + 10;
    }
    if (boardTop + boardH > viewHeight - 8) {
      boardTop = Math.max(12, viewHeight - boardH - 8);
    }
    const rowLeft = boardLeft + padX;
    const rowTop = boardTop + padTop;
    const board = this.root.ownerDocument.createElement("div");
    board.className = "logic-board";
    board.style.width = `${boardW}px`;
    board.style.height = `${boardH}px`;
    board.style.transform = `translate(${boardLeft}px, ${boardTop}px)`;
    board.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(board);
    this.nodes.push(board);
    const slotAt = (row: number, slot: number): { x: number; y: number } => ({
      x: rowLeft + slot * (bit + gap),
      y: rowTop + row * (bit + gap),
    });
    const fromBox = (box: Box): { x: number; y: number } => ({
      x: box.left + box.width / 2 - bit / 2,
      y: box.top + box.height / 2 - bit / 2,
    });
    const origins = [fromBox(destBox), fromBox(otherBox)];
    (["left", "right", "result"] as const).forEach((name, row) => {
      rows[name].forEach((value, slot) => {
        const chip = this.makeBit(value);
        chip.className = "logic-bit";
        chip.dataset.row = name;
        chip.dataset.slot = String(slot);
        chip.dataset.op = plan.op;
        const home = slotAt(row, slot);
        const origin = origins[row] ?? {
          x: (slotAt(0, slot).x + slotAt(1, slot).x) / 2,
          y: (slotAt(0, slot).y + slotAt(1, slot).y) / 2,
        };
        if (name === "result" && value !== rows.left[slot]) {
          chip.classList.add("chosen");
        }
        const appear = 0.3 + slot * 0.04;
        const frames = name === "result"
          ? [
            { transform: `translate(${origin.x}px, ${origin.y}px) scale(0.3)`, opacity: 0 },
            { transform: `translate(${origin.x}px, ${origin.y}px) scale(0.3)`, opacity: 0, offset: Math.max(0.05, appear - 0.06) },
            { transform: `translate(${home.x}px, ${home.y}px) scale(1.12)`, opacity: 1, offset: Math.min(0.78, appear + 0.08) },
            { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 1, offset: 0.86 },
            { transform: `translate(${home.x}px, ${home.y}px) scale(0.8)`, opacity: 0 },
          ]
          : [
            { transform: `translate(${origin.x}px, ${origin.y}px) scale(0.45)`, opacity: 0.15 },
            { transform: `translate(${home.x}px, ${home.y}px) scale(1.06)`, opacity: 1, offset: 0.22 },
            { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 1, offset: 0.86 },
            { transform: `translate(${home.x}px, ${home.y}px) scale(0.9)`, opacity: 0 },
          ];
        this.animate(chip, frames, LOGIC_MS, "linear");
      });
    });

    const op = this.root.ownerDocument.createElement("div");
    op.className = "logic-op";
    op.dataset.op = plan.op;
    op.textContent = plan.op.toUpperCase();
    op.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(op);
    this.nodes.push(op);
    const opX = boardLeft + boardW / 2 - 36;
    const opY = boardTop + 8;
    this.animate(op, [
      { transform: `translate(${opX}px, ${destBox.top}px) scale(0.6)`, opacity: 0 },
      { transform: `translate(${opX}px, ${opY}px) scale(1)`, opacity: 1, offset: 0.18 },
      { transform: `translate(${opX}px, ${opY}px) scale(1)`, opacity: 1, offset: 0.82 },
      { transform: `translate(${opX}px, ${opY}px) scale(0.9)`, opacity: 0 },
    ], LOGIC_MS, "linear");

    const token = this.root.ownerDocument.createElement("div");
    token.className = "logic-result";
    token.dataset.value = String(plan.result);
    token.dataset.format = format;
    token.textContent = formatByte(plan.result, format);
    token.style.opacity = "0";
    token.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(token);
    this.nodes.push(token);
    const width = token.offsetWidth || 52;
    const height = token.offsetHeight || 34;
    const resultHome = slotAt(2, 3);
    const start = { x: resultHome.x + bit / 2 - width / 2, y: resultHome.y };
    const end = {
      x: destBox.left + destBox.width / 2 - width / 2,
      y: destBox.top + destBox.height / 2 - height / 2,
    };
    this.animate(token, [
      { transform: `translate(${start.x}px, ${start.y}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${start.x}px, ${start.y}px) scale(0.4)`, opacity: 0, offset: 0.7 },
      { transform: `translate(${start.x}px, ${start.y - 8}px) scale(1.08)`, opacity: 1, offset: 0.82 },
      { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1 },
    ], LOGIC_MS, "linear");
  }

  private flyCounter(plan: CounterMotion, format: DisplayFormat, banks: Banks): void {
    const box = this.anchorBox(plan.anchor, banks, undefined) ?? { left: 80, top: 220, width: 48, height: 28 };
    this.dim(plan.anchor, banks);
    this.dimCompanions(plan, banks);
    const digits = counterDigits(plan.before, plan.after, format, plan.width, plan.dir);
    const count = digits.wheels.length;
    const digitW = count > 8 ? 18 : 42;
    const digitH = count > 8 ? 32 : 56;
    const gap = count > 8 ? 3 : 6;
    const rowWidth = count * digitW + Math.max(0, count - 1) * gap;
    const padX = 16;
    const padTop = 44;
    const padBottom = 14;
    const boardW = rowWidth + padX * 2;
    const boardH = digitH + padTop + padBottom;
    const view = this.root.ownerDocument.defaultView;
    const viewWidth = view?.innerWidth || 1200;
    const viewHeight = view?.innerHeight || 900;
    let boardLeft = box.left + box.width / 2 - boardW / 2;
    boardLeft = Math.max(12, Math.min(boardLeft, viewWidth - boardW - 12));
    let boardTop = box.top - boardH - 28;
    if (boardTop < 12) {
      boardTop = box.top + box.height + 12;
    }
    if (boardTop + boardH > viewHeight - 8) {
      boardTop = Math.max(12, viewHeight - boardH - 8);
    }
    const rowLeft = boardLeft + padX;
    const rowTop = boardTop + padTop;
    const board = this.root.ownerDocument.createElement("div");
    board.className = "counter-board";
    board.style.width = `${boardW}px`;
    board.style.height = `${boardH}px`;
    board.style.transform = `translate(${boardLeft}px, ${boardTop}px)`;
    board.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(board);
    this.nodes.push(board);
    const label = this.root.ownerDocument.createElement("div");
    label.className = "counter-op";
    label.dataset.dir = plan.dir;
    label.textContent = plan.dir.toUpperCase();
    label.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(label);
    this.nodes.push(label);
    label.style.transform = `translate(${boardLeft + boardW / 2 - 36}px, ${boardTop + 8}px)`;
    const offsets = Array.from({ length: count }, () => 0);
    let wait = 0;
    for (let index = count - 1; index >= 0; index -= 1) {
      offsets[index] = wait;
      if (digits.wheels[index]?.turns) {
        wait += 0.16;
      }
    }
    const rollSpan = 0.34;
    const scale = wait + rollSpan > 0.92 ? 0.92 / (wait + rollSpan) : 1;
    const roll = this.root.ownerDocument.createElement("div");
    roll.className = "counter-roll";
    roll.dataset.dir = plan.dir;
    roll.dataset.format = format;
    roll.dataset.from = digits.from;
    roll.dataset.to = digits.to;
    roll.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(roll);
    this.nodes.push(roll);

    digits.wheels.forEach((wheel, slot) => {
      const node = this.root.ownerDocument.createElement("div");
      node.className = "counter-wheel";
      node.dataset.slot = String(slot);
      node.dataset.from = wheel.from;
      node.dataset.to = wheel.to;
      node.dataset.turns = wheel.turns ? "1" : "0";
      node.dataset.dir = plan.dir;
      node.style.width = `${digitW}px`;
      node.style.height = `${digitH}px`;
      const strip = this.root.ownerDocument.createElement("div");
      strip.className = "counter-strip";
      const path = plan.dir === "dec" ? [...wheel.path].reverse() : wheel.path;
      for (const glyph of path) {
        const cell = this.root.ownerDocument.createElement("span");
        cell.className = "counter-glyph";
        cell.textContent = glyph;
        cell.style.height = `${digitH}px`;
        strip.append(cell);
      }
      node.append(strip);
      roll.append(node);
      const x = rowLeft + slot * (digitW + gap);
      const y = rowTop;
      node.style.transform = `translate(${x}px, ${y}px)`;
      const distance = (path.length - 1) * digitH;
      const startY = plan.dir === "dec" ? -distance : 0;
      const endY = plan.dir === "dec" ? 0 : -distance;
      const begin = (offsets[slot] ?? 0) * scale;
      const finish = Math.min(0.98, begin + rollSpan * scale);
      const hold = `translate(0px, ${startY}px)`;
      const landed = `translate(0px, ${endY}px)`;
      this.animate(strip, wheel.path.length <= 1
        ? [{ transform: hold }, { transform: hold }]
        : [
          { transform: hold, offset: 0 },
          { transform: hold, offset: begin },
          { transform: landed, offset: finish },
          { transform: landed, offset: 1 },
        ], COUNTER_MS, "linear");
    });
  }

  private dimCompanions(plan: CounterMotion, banks: Banks): void {
    if (plan.anchor.type !== "reg") {
      return;
    }
    const extra: RegName[] = [];
    if (plan.width === 16) {
      if (plan.anchor.name === "bc") {
        extra.push("b", "c");
      } else if (plan.anchor.name === "de") {
        extra.push("d", "e");
      } else if (plan.anchor.name === "hl") {
        extra.push("h", "l");
      }
    } else if (plan.anchor.name === "a") {
      extra.push("af");
    } else if (plan.anchor.name === "b" || plan.anchor.name === "c") {
      extra.push("bc");
    } else if (plan.anchor.name === "d" || plan.anchor.name === "e") {
      extra.push("de");
    } else if (plan.anchor.name === "h" || plan.anchor.name === "l") {
      extra.push("hl");
    }
    for (const name of extra) {
      this.dim({ type: "reg", name }, banks);
    }
  }

  private showFlag(banks: Banks, key: string, on: boolean): void {
    const element = this.flagElement(banks, key);
    if (element === null) {
      return;
    }
    const was = element.dataset.set === "1";
    element.dataset.set = on ? "1" : "0";
    element.classList.toggle("set", on);
    const state = element.querySelector(".flag-state");
    if (state !== null) {
      state.textContent = on ? "1" : "0";
    }
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

  private scaled(ms: number): number {
    return scaledMs(ms, this.rate);
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
      duration: this.scaled(duration),
      easing,
      fill: "forwards",
    });
    this.animations.push(animation);
    const generation = this.generation;
    animation.onfinish = () => {
      if (generation !== this.generation || this.held || this.frozen) {
        return;
      }
      if (this.animations.every((item) => item.playState === "finished")) {
        this.complete?.();
      }
    };
  }

  private flyAlu(plan: ArithMotion, format: DisplayFormat, banks: Banks, sourceRect: Box | undefined): void {
    const destBox = this.anchorBox(plan.dest, banks, sourceRect) ?? { left: 80, top: 220, width: 40, height: 28 };
    const otherBox = this.anchorBox(plan.other, banks, sourceRect) ?? destBox;
    if (plan.stored) {
      this.dim(plan.dest, banks);
    }
    if (plan.other.type !== "source") {
      this.dim(plan.other, banks);
    }
    const bit = 28;
    const gap = 6;
    const rowWidth = 8 * bit + 7 * gap;
    const rows = 3;
    const stackHeight = rows * bit + (rows - 1) * gap;
    const padX = 16;
    const padTop = 46;
    const padBottom = 14;
    const board = this.placeBoard("alu-board", rowWidth + padX * 2, stackHeight + padTop + padBottom, destBox);
    board.dataset.op = plan.op;
    board.dataset.result = String(plan.result);
    board.dataset.stored = plan.stored ? "1" : "0";
    const rowLeft = Number(board.dataset.left) + padX;
    const rowTop = Number(board.dataset.top) + padTop;
    const slotAt = (row: number, slot: number) => ({
      x: rowLeft + slot * (bit + gap),
      y: rowTop + row * (bit + gap),
    });
    const fromBox = (box: Box) => ({
      x: box.left + box.width / 2 - bit / 2,
      y: box.top + box.height / 2 - bit / 2,
    });
    const origins = [fromBox(destBox), fromBox(otherBox)];
    const bySlot = [...plan.columns].sort((a, b) => b.bit - a.bit);
    (["left", "right", "result"] as const).forEach((name, row) => {
      bySlot.forEach((column, slot) => {
        const value = name === "left" ? column.left : name === "right" ? column.right : column.sum;
        const chip = this.makeBit(value);
        chip.className = "alu-bit";
        chip.dataset.row = name;
        chip.dataset.slot = String(slot);
        chip.dataset.bit = String(column.bit);
        chip.dataset.op = plan.op;
        const home = slotAt(row, slot);
        const origin = origins[row] ?? {
          x: (slotAt(0, slot).x + slotAt(1, slot).x) / 2,
          y: (slotAt(0, slot).y + slotAt(1, slot).y) / 2,
        };
        const appear = name === "result" ? 0.34 + (7 - column.bit) * 0.06 : 0.16;
        this.animate(chip, [
          { transform: `translate(${origin.x}px, ${origin.y}px) scale(0.4)`, opacity: 0 },
          { transform: `translate(${origin.x}px, ${origin.y}px) scale(0.4)`, opacity: 0, offset: Math.max(0.04, appear - 0.05) },
          { transform: `translate(${home.x}px, ${home.y}px) scale(1.08)`, opacity: 1, offset: Math.min(0.82, appear + 0.08) },
          { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 1, offset: 0.9 },
          { transform: `translate(${home.x}px, ${home.y}px) scale(0.85)`, opacity: name === "result" ? 0 : 0.2 },
        ], ALU_MS, "linear");
      });
    });
    const borrow = plan.op === "sub" || plan.op === "sbc" || plan.op === "cp";
    for (const column of plan.columns) {
      if (column.carryOut !== 1) {
        continue;
      }
      const fromSlot = 7 - column.bit;
      const intoBit = column.bit + 1;
      const chip = this.makeBit(1);
      chip.className = "alu-carry";
      chip.dataset.bit = String(column.bit);
      chip.dataset.value = "1";
      chip.dataset.kind = borrow ? "borrow" : "carry";
      const start = slotAt(1, fromSlot);
      const end = intoBit < 8
        ? slotAt(2, 7 - intoBit)
        : this.flagPoint(banks, "c", { x: start.x + bit + 8, y: start.y - 36 });
      if (intoBit < 8) {
        chip.dataset.into = String(intoBit);
      } else {
        chip.dataset.into = "c";
      }
      const begin = 0.3 + column.bit * 0.06;
      const done = Math.min(0.86, begin + 0.1);
      this.animate(chip, [
        { transform: `translate(${start.x}px, ${start.y - 8}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${start.x}px, ${start.y - 8}px) scale(0.7)`, opacity: 1, offset: begin },
        { transform: `translate(${end.x}px, ${end.y - 10}px) scale(1.1)`, opacity: 1, offset: done },
        { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1, offset: 0.92 },
        { transform: `translate(${end.x}px, ${end.y}px) scale(0.8)`, opacity: 0 },
      ], ALU_MS, "linear");
    }
    this.labelChip("alu-op", plan.op.toUpperCase(), board, plan.op);
    const token = this.resultChip("alu-result", formatByte(plan.result, format), plan.result, format);
    token.dataset.stored = plan.stored ? "1" : "0";
    token.dataset.op = plan.op;
    const width = token.offsetWidth || 52;
    const height = token.offsetHeight || 34;
    const resultHome = slotAt(2, 3);
    const start = { x: resultHome.x + bit / 2 - width / 2, y: resultHome.y };
    const end = {
      x: destBox.left + destBox.width / 2 - width / 2,
      y: destBox.top + destBox.height / 2 - height / 2,
    };
    this.animate(token, plan.stored
      ? [
        { transform: `translate(${start.x}px, ${start.y}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${start.x}px, ${start.y}px) scale(0.4)`, opacity: 0, offset: 0.72 },
        { transform: `translate(${start.x}px, ${start.y - 8}px) scale(1.08)`, opacity: 1, offset: 0.84 },
        { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1 },
      ]
      : [
        { transform: `translate(${start.x}px, ${start.y}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${start.x}px, ${start.y}px) scale(0.4)`, opacity: 0, offset: 0.7 },
        { transform: `translate(${start.x}px, ${start.y - 8}px) scale(1.08)`, opacity: 1, offset: 0.84 },
        { transform: `translate(${start.x}px, ${start.y - 8}px) scale(1)`, opacity: 1 },
      ], ALU_MS, "linear");
    this.revealFlags(banks, plan.flags, ALU_MS);
  }

  private flyWord(plan: WordMotion, format: DisplayFormat, banks: Banks): void {
    const destBox = this.anchorBox({ type: "reg", name: plan.dest }, banks, undefined) ?? { left: 120, top: 240, width: 64, height: 28 };
    this.dim({ type: "reg", name: plan.dest }, banks);
    const cellW = format === "binary" ? 92 : 54;
    const cellH = 32;
    const gap = 8;
    const pairW = cellW * 2 + gap;
    const boardW = pairW + 28;
    const boardH = cellH * 3 + 46 + 18;
    const board = this.placeBoard("word-board", boardW, boardH, destBox);
    board.dataset.op = plan.op;
    board.dataset.dest = plan.dest;
    board.dataset.result = String(plan.result);
    const left = Number(board.dataset.left) + 14;
    const top = Number(board.dataset.top) + 42;
    const place = (row: number, high: boolean) => ({
      x: left + (high ? 0 : cellW + gap),
      y: top + row * (cellH + 6),
    });
    const low = plan.halves[0];
    const high = plan.halves[1];
    ([
      ["left", 0, high.left, low.left],
      ["right", 1, high.right, low.right],
      ["result", 2, high.result, low.result],
    ] as const).forEach(([row, index, highByte, lowByte]) => {
      ([["high", highByte, true], ["low", lowByte, false]] as const).forEach(([half, value, isHigh]) => {
        const chip = this.root.ownerDocument.createElement("div");
        chip.className = "word-byte";
        chip.dataset.row = row;
        chip.dataset.half = half;
        chip.dataset.value = String(value);
        chip.textContent = formatByte(value, format).trim();
        chip.setAttribute("aria-hidden", "true");
        chip.style.width = `${cellW}px`;
        this.root.ownerDocument.body.append(chip);
        this.nodes.push(chip);
        const home = place(index, isHigh);
        const origin = { x: destBox.left, y: destBox.top };
        const appear = row === "result" ? 0.55 : 0.18;
        this.animate(chip, [
          { transform: `translate(${origin.x}px, ${origin.y}px) scale(0.5)`, opacity: 0 },
          { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 1, offset: appear },
          { transform: `translate(${home.x}px, ${home.y}px) scale(1)`, opacity: 1, offset: 0.9 },
          { transform: `translate(${home.x}px, ${home.y}px) scale(0.9)`, opacity: row === "result" ? 0 : 0.3 },
        ], WORD_MS, "linear");
      });
    });
    const carry = this.makeBit(low.carryOut);
    carry.className = "word-carry";
    carry.dataset.value = String(low.carryOut);
    carry.dataset.kind = plan.op === "sbc" ? "borrow" : "carry";
    const from = place(2, false);
    const to = place(2, true);
    this.animate(carry, [
      { transform: `translate(${from.x + cellW - 16}px, ${from.y - 6}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${from.x + cellW - 16}px, ${from.y - 18}px) scale(1)`, opacity: 1, offset: 0.42 },
      { transform: `translate(${to.x + cellW - 8}px, ${to.y - 18}px) scale(1.12)`, opacity: 1, offset: 0.62 },
      { transform: `translate(${to.x + 8}px, ${to.y}px) scale(1)`, opacity: 1, offset: 0.78 },
      { transform: `translate(${to.x + 8}px, ${to.y}px) scale(0.8)`, opacity: 0 },
    ], WORD_MS, "linear");
    const title = plan.op === "add" ? `ADD ${plan.dest.toUpperCase()}` : `${plan.op.toUpperCase()} ${plan.dest.toUpperCase()}`;
    this.labelChip("word-op", title, board, plan.op);
    const token = this.resultChip("word-result", formatWord(plan.result, format).trim(), plan.result, format);
    token.dataset.dest = plan.dest;
    const width = token.offsetWidth || 72;
    const height = token.offsetHeight || 34;
    const start = place(2, true);
    const end = {
      x: destBox.left + destBox.width / 2 - width / 2,
      y: destBox.top + destBox.height / 2 - height / 2,
    };
    this.animate(token, [
      { transform: `translate(${start.x}px, ${start.y}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${start.x}px, ${start.y}px) scale(0.4)`, opacity: 0, offset: 0.72 },
      { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1 },
    ], WORD_MS, "linear");
    this.revealFlags(banks, plan.flags, WORD_MS);
  }

  private flyDaa(plan: DaaMotion, format: DisplayFormat, banks: Banks): void {
    const box = this.anchorBox({ type: "reg", name: "a" }, banks, undefined) ?? { left: 80, top: 220, width: 40, height: 28 };
    this.dim({ type: "reg", name: "a" }, banks);
    const digits = counterDigits(plan.before, plan.after, "hex", 8, plan.subtract ? "dec" : "inc");
    const digitW = 42;
    const digitH = 56;
    const board = this.placeBoard("daa-board", 210, 150, box);
    board.dataset.before = String(plan.before);
    board.dataset.after = String(plan.after);
    board.dataset.correction = String(plan.correction);
    board.dataset.subtract = plan.subtract ? "1" : "0";
    const originX = Number(board.dataset.left);
    const originY = Number(board.dataset.top);
    (["h", "n", "c"] as const).forEach((flag, index) => {
      const pill = this.root.ownerDocument.createElement("div");
      pill.className = "daa-flag";
      pill.dataset.flag = flag;
      pill.dataset.value = plan[flag] ? "1" : "0";
      pill.textContent = `${flag.toUpperCase()} ${plan[flag] ? "1" : "0"}`;
      pill.setAttribute("aria-hidden", "true");
      this.root.ownerDocument.body.append(pill);
      this.nodes.push(pill);
      const x = originX + 12 + index * 64;
      const y = originY + 8;
      this.animate(pill, [
        { transform: `translate(${x}px, ${box.top}px)`, opacity: 0 },
        { transform: `translate(${x}px, ${y}px)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${x}px, ${y}px)`, opacity: 1 },
      ], DAA_MS, "linear");
    });
    const correction = this.root.ownerDocument.createElement("div");
    correction.className = "daa-correction";
    const sign = plan.subtract ? "−" : "+";
    correction.textContent = plan.correction === 0 ? "0" : `${sign}${plan.correction.toString(16).toUpperCase().padStart(2, "0")}`;
    correction.dataset.correction = String(plan.correction);
    correction.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(correction);
    this.nodes.push(correction);
    correction.style.transform = `translate(${originX + 12}px, ${originY + 40}px)`;
    const roll = this.root.ownerDocument.createElement("div");
    roll.className = "daa-roll";
    roll.dataset.from = digits.from;
    roll.dataset.to = digits.to;
    roll.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(roll);
    this.nodes.push(roll);
    digits.wheels.forEach((wheel, slot) => {
      const node = this.root.ownerDocument.createElement("div");
      node.className = "daa-digit";
      node.dataset.place = slot === 0 ? "high" : "low";
      node.dataset.from = wheel.from;
      node.dataset.to = wheel.to;
      node.style.width = `${digitW}px`;
      node.style.height = `${digitH}px`;
      const strip = this.root.ownerDocument.createElement("div");
      strip.className = "counter-strip";
      const path = plan.subtract ? [...wheel.path].reverse() : wheel.path;
      for (const glyph of path) {
        const cell = this.root.ownerDocument.createElement("span");
        cell.className = "counter-glyph";
        cell.textContent = glyph;
        cell.style.height = `${digitH}px`;
        strip.append(cell);
      }
      node.append(strip);
      roll.append(node);
      const x = originX + 78 + slot * (digitW + 8);
      const y = originY + 72;
      node.style.transform = `translate(${x}px, ${y}px)`;
      const distance = (path.length - 1) * digitH;
      const startY = plan.subtract ? -distance : 0;
      const endY = plan.subtract ? 0 : -distance;
      this.animate(strip, wheel.path.length <= 1
        ? [{ transform: `translate(0px, ${startY}px)` }, { transform: `translate(0px, ${startY}px)` }]
        : [
          { transform: `translate(0px, ${startY}px)`, offset: 0 },
          { transform: `translate(0px, ${startY}px)`, offset: 0.28 },
          { transform: `translate(0px, ${endY}px)`, offset: 0.72 },
          { transform: `translate(0px, ${endY}px)`, offset: 1 },
        ], DAA_MS, "linear");
    });
    const token = this.resultChip("daa-result", formatByte(plan.after, format), plan.after, format);
    const width = token.offsetWidth || 52;
    const height = token.offsetHeight || 34;
    const end = {
      x: box.left + box.width / 2 - width / 2,
      y: box.top + box.height / 2 - height / 2,
    };
    this.animate(token, [
      { transform: `translate(${originX + 78}px, ${originY + 78}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${originX + 78}px, ${originY + 78}px) scale(0.4)`, opacity: 0, offset: 0.74 },
      { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1 },
    ], DAA_MS, "linear");
    this.revealFlags(banks, plan.flags, DAA_MS);
  }

  private flyBranch(plan: BranchMotion, format: DisplayFormat, banks: Banks): void {
    if (plan.kind === "djnz" && plan.before !== undefined && plan.after !== undefined) {
      this.flyCounter({
        type: "counter",
        dir: "dec",
        width: 8,
        anchor: { type: "reg", name: "b" },
        before: plan.before,
        after: plan.after,
      }, format, banks);
      const op = [...this.nodes].reverse().find((node) => node.classList.contains("counter-op"));
      if (op !== undefined) {
        op.textContent = "DJNZ";
        op.dataset.dir = "djnz";
      }
    }
    if (!plan.taken || plan.fromLine === undefined || plan.toLine === undefined) {
      return;
    }
    const from = this.root.querySelector<HTMLElement>(`.gutter-row[data-line="${plan.fromLine}"]`);
    const to = this.root.querySelector<HTMLElement>(`.gutter-row[data-line="${plan.toLine}"]`);
    const fromBox = boxOf(from);
    const toBox = boxOf(to);
    if (fromBox === undefined || toBox === undefined) {
      return;
    }
    const chip = this.root.ownerDocument.createElement("div");
    chip.className = "branch-hop";
    chip.dataset.kind = plan.kind;
    chip.dataset.taken = "1";
    chip.dataset.displacement = String(plan.displacement);
    chip.dataset.fromLine = String(plan.fromLine);
    chip.dataset.toLine = String(plan.toLine);
    const sign = plan.displacement > 0 ? "+" : "";
    chip.textContent = `${sign}${plan.displacement}`;
    chip.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(chip);
    this.nodes.push(chip);
    const width = chip.offsetWidth || 48;
    const x = fromBox.left + fromBox.width + 8;
    const startY = fromBox.top + fromBox.height / 2 - 14;
    const endY = toBox.top + toBox.height / 2 - 14;
    const steps = Math.max(1, Math.abs(plan.toLine - plan.fromLine));
    const frames: Keyframe[] = [];
    for (let step = 0; step <= steps; step += 1) {
      const y = startY + (endY - startY) * (step / steps);
      const lift = step === steps ? 0 : -16;
      frames.push({
        transform: `translate(${x}px, ${y + lift}px)`,
        offset: step / steps,
      });
    }
    this.animate(chip, frames, BRANCH_MS, "linear");
  }

  private flyNibble(plan: NibbleMotion, format: DisplayFormat, banks: Banks): void {
    const aBox = this.anchorBox({ type: "reg", name: "a" }, banks, undefined) ?? { left: 80, top: 220, width: 40, height: 28 };
    const memBox = this.anchorBox({ type: "mem", address: plan.address }, banks, undefined) ?? aBox;
    this.dim({ type: "reg", name: "a" }, banks);
    this.dim({ type: "mem", address: plan.address }, banks);
    const board = this.placeBoard("nibble-board", 250, 110, aBox);
    board.dataset.op = plan.op;
    board.dataset.address = String(plan.address);
    const originX = Number(board.dataset.left);
    const originY = Number(board.dataset.top);
    const places = ["a-low", "mem-high", "mem-low"] as const;
    const home = (place: (typeof places)[number]) => {
      const index = places.indexOf(place);
      return { x: originX + 16 + index * 76, y: originY + 48 };
    };
    const aLow = plan.aBefore & 0x0f;
    const memHigh = (plan.memBefore >> 4) & 0x0f;
    const memLow = plan.memBefore & 0x0f;
    const order = plan.op === "rld"
      ? [
        { value: memHigh, from: "mem-high", to: "a-low", origin: memBox },
        { value: memLow, from: "mem-low", to: "mem-high", origin: memBox },
        { value: aLow, from: "a-low", to: "mem-low", origin: aBox },
      ]
      : [
        { value: memLow, from: "mem-low", to: "a-low", origin: memBox },
        { value: aLow, from: "a-low", to: "mem-high", origin: aBox },
        { value: memHigh, from: "mem-high", to: "mem-low", origin: memBox },
      ];
    for (const part of order) {
      const chip = this.root.ownerDocument.createElement("div");
      chip.className = "nibble-chip";
      chip.dataset.op = plan.op;
      chip.dataset.value = part.value.toString(16).toUpperCase();
      chip.dataset.from = part.from;
      chip.dataset.to = part.to;
      chip.textContent = part.value.toString(16).toUpperCase();
      chip.setAttribute("aria-hidden", "true");
      this.root.ownerDocument.body.append(chip);
      this.nodes.push(chip);
      const start = {
        x: part.origin.left + part.origin.width / 2 - 18,
        y: part.origin.top + part.origin.height / 2 - 16,
      };
      const slot = home(part.from as (typeof places)[number]);
      const next = home(part.to as (typeof places)[number]);
      this.animate(chip, [
        { transform: `translate(${start.x}px, ${start.y}px) scale(0.6)`, opacity: 0.2 },
        { transform: `translate(${slot.x}px, ${slot.y}px) scale(1)`, opacity: 1, offset: 0.28 },
        { transform: `translate(${next.x}px, ${next.y - 12}px) scale(1.08)`, opacity: 1, offset: 0.62 },
        { transform: `translate(${next.x}px, ${next.y}px) scale(1)`, opacity: 1, offset: 0.82 },
        { transform: `translate(${next.x}px, ${next.y}px) scale(0.9)`, opacity: 0.3 },
      ], NIBBLE_MS, "linear");
    }
    const aToken = this.resultChip("nibble-result", formatByte(plan.aAfter, format), plan.aAfter, format);
    aToken.dataset.dest = "a";
    const memToken = this.resultChip("nibble-result", formatByte(plan.memAfter, format), plan.memAfter, format);
    memToken.dataset.dest = "mem";
    const aEnd = {
      x: aBox.left + aBox.width / 2 - (aToken.offsetWidth || 52) / 2,
      y: aBox.top + aBox.height / 2 - 17,
    };
    const memEnd = {
      x: memBox.left + memBox.width / 2 - (memToken.offsetWidth || 52) / 2,
      y: memBox.top + memBox.height / 2 - 17,
    };
    this.animate(aToken, [
      { transform: `translate(${home("a-low").x}px, ${home("a-low").y}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${home("a-low").x}px, ${home("a-low").y}px) scale(0.4)`, opacity: 0, offset: 0.75 },
      { transform: `translate(${aEnd.x}px, ${aEnd.y}px) scale(1)`, opacity: 1 },
    ], NIBBLE_MS, "linear");
    this.animate(memToken, [
      { transform: `translate(${home("mem-high").x}px, ${home("mem-high").y}px) scale(0.4)`, opacity: 0 },
      { transform: `translate(${home("mem-high").x}px, ${home("mem-high").y}px) scale(0.4)`, opacity: 0, offset: 0.75 },
      { transform: `translate(${memEnd.x}px, ${memEnd.y}px) scale(1)`, opacity: 1 },
    ], NIBBLE_MS, "linear");
    this.revealFlags(banks, plan.flags, NIBBLE_MS);
  }

  private placeBoard(className: string, width: number, height: number, near: Box): HTMLDivElement {
    const view = this.root.ownerDocument.defaultView;
    const viewWidth = view?.innerWidth || 1200;
    const viewHeight = view?.innerHeight || 900;
    let left = near.left + near.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, viewWidth - width - 12));
    let top = near.top - height - 12;
    if (top < 12) {
      top = near.top + near.height + 12;
    }
    if (top + height > viewHeight - 8) {
      top = Math.max(12, viewHeight - height - 8);
    }
    const board = this.root.ownerDocument.createElement("div");
    board.className = className;
    board.style.width = `${width}px`;
    board.style.height = `${height}px`;
    board.style.transform = `translate(${left}px, ${top}px)`;
    board.dataset.left = String(left);
    board.dataset.top = String(top);
    board.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(board);
    this.nodes.push(board);
    return board;
  }

  private labelChip(className: string, text: string, board: HTMLElement, op: string): void {
    const label = this.root.ownerDocument.createElement("div");
    label.className = className;
    label.dataset.op = op;
    label.textContent = text;
    label.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(label);
    this.nodes.push(label);
    const left = Number(board.dataset.left);
    const top = Number(board.dataset.top);
    label.style.transform = `translate(${left + 8}px, ${top + 8}px)`;
  }

  private resultChip(className: string, text: string, value: number, format: DisplayFormat): HTMLDivElement {
    const token = this.root.ownerDocument.createElement("div");
    token.className = className;
    token.dataset.value = String(value);
    token.dataset.format = format;
    token.textContent = text;
    token.style.opacity = "0";
    token.setAttribute("aria-hidden", "true");
    this.root.ownerDocument.body.append(token);
    this.nodes.push(token);
    return token;
  }

  private flagPoint(banks: Banks, key: string, fallback: { x: number; y: number }): { x: number; y: number } {
    const box = boxOf(this.flagElement(banks, key));
    if (box === undefined) {
      return fallback;
    }
    return { x: box.left + box.width / 2 - 14, y: box.top + box.height / 2 - 14 };
  }

  private revealFlags(banks: Banks, flags: FlagPicture, duration: number): void {
    const generation = this.generation;
    this.later(this.scaled(duration * 0.86), () => {
      if (generation !== this.generation) {
        return;
      }
      this.showFlag(banks, "s", flags.s);
      this.showFlag(banks, "z", flags.z);
      this.showFlag(banks, "h", flags.h);
      this.showFlag(banks, "pv", flags.pv);
      this.showFlag(banks, "n", flags.n);
      this.showFlag(banks, "c", flags.c);
    });
  }
}

function planDuration(plan: MotionPlan): number {
  switch (plan.type) {
    case "shift":
    case "bit":
      return SHIFT_MS;
    case "logic":
      return LOGIC_MS;
    case "counter":
      return COUNTER_MS;
    case "alu":
      return ALU_MS;
    case "word":
      return WORD_MS;
    case "daa":
      return DAA_MS;
    case "branch":
      return BRANCH_MS;
    case "nibble":
      return NIBBLE_MS;
    default:
      return MOTION_MS;
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
