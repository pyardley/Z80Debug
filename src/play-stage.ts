import type { Banks } from "./machine";
import { asciiGlyph, formatByte, formatWord, type DisplayFormat } from "./format";
import {
  COUNTER_MS,
  LOGIC_MS,
  MOTION_MS,
  SHIFT_MS,
  counterDigits,
  logicRows,
  shiftTracks,
  type Anchor,
  type MotionPlan,
  type RegName,
  type BitMotion,
  type CounterMotion,
  type LogicMotion,
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
    const duration = input.plan.type === "shift" || input.plan.type === "bit"
      ? SHIFT_MS
      : input.plan.type === "logic"
        ? LOGIC_MS
        : input.plan.type === "counter"
          ? COUNTER_MS
          : MOTION_MS;
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
    } else if (input.plan.type === "bit") {
      this.flyBitOp(input.plan, input.banks);
    } else if (input.plan.type === "logic") {
      this.flyLogic(input.plan, input.format, input.banks, input.sourceRect);
    } else if (input.plan.type === "counter") {
      this.flyCounter(input.plan, input.format, input.banks);
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
          this.timers.push(window.setTimeout(() => {
            if (generation !== this.generation) {
              return;
            }
            chip.dataset.value = String(next);
            chip.textContent = String(next);
          }, Math.round(SHIFT_MS * 0.5)));
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
    this.timers.push(window.setTimeout(() => {
      if (generation !== this.generation) {
        return;
      }
      this.showFlag(banks, "z", plan.zeroAfter);
    }, Math.round(SHIFT_MS * 0.8)));
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
