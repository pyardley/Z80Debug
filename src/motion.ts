import { hi } from "z80-base";
import type { DisplayFormat } from "./format";
import type { Machine, MemoryWrite } from "./machine";
import { formatStackLabel } from "./stack";

/** A short trip, about half a second. Stepping again cancels whatever is still in the air. */
export const MOTION_MS = 520;

/** A word splits into two bytes, or two bytes join into a word, then the chip finishes the trip. */
export const PAIR_MS = 1080;

/** Pop the byte into bits, slide them, and land the leaving bit on Carry. */
export const SHIFT_MS = 900;

/** Pop both bytes into bits, combine each column, then land the result. */
export const LOGIC_MS = 1200;

/** Roll the digits that are on screen, then show the register again. */
export const COUNTER_MS = 1100;

/** Show both values as decimal digits, then step a carry or borrow to the next digit. */
export const ALU_MS = 1400;

/** Show both words as decimal numbers, then step a carry or borrow to the next digit. */
export const WORD_MS = 1300;

/** Adjust the two hex digits of A from H, N, and C. */
export const DAA_MS = 1200;

/** Roll B, or hop along the source, for DJNZ and JR. */
export const BRANCH_MS = 1100;

/** Rotate the low nibble of A with the two nibbles at (HL). */
export const NIBBLE_MS = 1100;

/** Playback rate for every toy animation. 1 is the pace the page opens with. */
export const SPEED_STORAGE_KEY = "z80debug.animationSpeed";
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 2;
export const SPEED_DEFAULT = 1;

export function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) {
    return SPEED_DEFAULT;
  }
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
  return Math.round(clamped * 100) / 100;
}

/** How long a built-in duration lasts at this rate. 0.1× takes ten times as long. */
export function scaledMs(base: number, rate: number): number {
  return Math.round(base / clampSpeed(rate));
}

export function loadSpeed(storage: Pick<Storage, "getItem">): number {
  const stored = storage.getItem(SPEED_STORAGE_KEY);
  if (stored === null || stored.trim() === "") {
    return SPEED_DEFAULT;
  }
  return clampSpeed(Number(stored));
}

export function saveSpeed(storage: Pick<Storage, "setItem">, rate: number): void {
  storage.setItem(SPEED_STORAGE_KEY, String(clampSpeed(rate)));
}

export type ShiftKind = "rlc" | "rrc" | "rl" | "rr" | "sla" | "sra" | "sll" | "srl";

export interface ShiftTrack {
  value: 0 | 1;
  from: "bit" | "carry" | "fill";
  fromSlot?: number;
  to: "bit" | "carry";
  toSlot?: number;
}

export type RegName =
  | "a" | "f" | "b" | "c" | "d" | "e" | "h" | "l" | "i" | "r"
  | "ixh" | "ixl" | "iyh" | "iyl"
  | "af" | "bc" | "de" | "hl" | "sp" | "ix" | "iy" | "pc";

export type Anchor =
  | { type: "reg"; name: RegName }
  | { type: "mem"; address: number }
  | { type: "source" }
  | { type: "console" };

export interface Travel {
  from: Anchor;
  to: Anchor;
  value: number;
  width: 8 | 16;
  pop: boolean;
  /** Pair name, return, or source → destination. Present on stack traffic. */
  label?: string;
}

/** A register pair shown as two bytes. Split lands the bytes. Join sends the word. */
export interface PairMotion {
  type: "pair";
  dir: "split" | "join";
  value: number;
  high: number;
  low: number;
  highReg: RegName;
  lowReg: RegName;
  /** Where the word starts (split) or lands (join). */
  word: Anchor;
  label?: string;
}

export interface ShiftMotion {
  type: "shift";
  anchor: { type: "reg"; name: RegName } | { type: "mem"; address: number };
  before: number;
  after: number;
  carryBefore: boolean;
  carryAfter: boolean;
  kind: ShiftKind;
  /** CB shifts set S, Z, and P/V from the result. RLCA, RRCA, RLA, and RRA do not. */
  flagsFromResult: boolean;
  sign: boolean;
  zero: boolean;
  parity: boolean;
}

export type LogicOp = "and" | "or" | "xor";

export interface LogicMotion {
  type: "logic";
  op: LogicOp;
  /** Accumulator before the instruction. */
  left: number;
  /** The other operand. */
  right: number;
  result: number;
  other: { type: "reg"; name: RegName } | { type: "mem"; address: number } | { type: "source" };
  dest: { type: "reg"; name: "a" };
}

export type CounterDir = "inc" | "dec";

export interface CounterMotion {
  type: "counter";
  dir: CounterDir;
  width: 8 | 16;
  anchor: { type: "reg"; name: RegName } | { type: "mem"; address: number };
  before: number;
  after: number;
}

export interface CounterWheel {
  from: string;
  to: string;
  /** The wheel passes the end of its alphabet, so the next wheel steps. */
  turns: boolean;
  /** Glyphs visited, including the digit it starts on. */
  path: string[];
}

export type ArithOp = "add" | "adc" | "sub" | "sbc" | "cp";

export interface ArithColumn {
  /** 0 is the ones place. Display slot 0 is the highest place. */
  place: number;
  left: number;
  right: number;
  carryIn: 0 | 1;
  /** Schoolbook digit in this place. The register still keeps the CPU result. */
  digit: number;
  carryOut: 0 | 1;
}

export interface FlagPicture {
  s: boolean;
  z: boolean;
  h: boolean;
  pv: boolean;
  n: boolean;
  c: boolean;
}

export interface ArithMotion {
  type: "alu";
  op: ArithOp;
  left: number;
  right: number;
  /** The arithmetic result. CP computes it and does not store it. */
  result: number;
  stored: boolean;
  columns: ArithColumn[];
  other: { type: "reg"; name: RegName } | { type: "mem"; address: number } | { type: "source" };
  dest: { type: "reg"; name: "a" };
  flags: FlagPicture;
}

export type WordOp = "add" | "adc" | "sbc";

export interface WordMotion {
  type: "word";
  op: WordOp;
  dest: RegName;
  other: RegName;
  left: number;
  right: number;
  result: number;
  /** Index 0 is the ones place. Five places cover 0–65535. */
  columns: ArithColumn[];
  flags: FlagPicture;
}

export interface DaaMotion {
  type: "daa";
  before: number;
  after: number;
  /** Byte added, or subtracted when N is set. */
  correction: number;
  subtract: boolean;
  low: boolean;
  high: boolean;
  h: boolean;
  n: boolean;
  c: boolean;
  flags: FlagPicture;
}

export interface BranchMotion {
  type: "branch";
  kind: "djnz" | "jr";
  taken: boolean;
  displacement: number;
  fromLine: number | undefined;
  toLine: number | undefined;
  /** Present for DJNZ. B decreases whether or not the branch is taken. */
  before?: number;
  after?: number;
}

export interface NibbleMotion {
  type: "nibble";
  op: "rld" | "rrd";
  aBefore: number;
  aAfter: number;
  memBefore: number;
  memAfter: number;
  address: number;
  flags: FlagPicture;
}

export type BitOp = "set" | "res" | "bit";

export interface BitMotion {
  type: "bit";
  anchor: { type: "reg"; name: RegName } | { type: "mem"; address: number };
  before: number;
  after: number;
  /** 0 is the least significant bit. */
  bit: number;
  op: BitOp;
  /** BIT sets Z to the opposite of the tested bit. SET and RES leave Z alone. */
  zeroBefore: boolean;
  zeroAfter: boolean;
}

export type MotionPlan =
  | { type: "none" }
  | { type: "swap"; group: "af" | "exx" }
  | { type: "travel"; moves: Travel[] }
  | PairMotion
  | ShiftMotion
  | BitMotion
  | LogicMotion
  | CounterMotion
  | ArithMotion
  | WordMotion
  | DaaMotion
  | BranchMotion
  | NibbleMotion;

export interface MotionFacts {
  mnemonic: string;
  a: number;
  af: number;
  bc: number;
  de: number;
  hl: number;
  sp: number;
  pc: number;
  ix: number;
  iy: number;
  i: number;
  r: number;
  spBefore: number;
  pcBefore: number;
  hlBefore: number;
  bcBefore: number;
  deBefore: number;
  ixBefore: number;
  iyBefore: number;
  writes: readonly MemoryWrite[];
  consoleOut: number | undefined;
  consoleIn: boolean;
}

export interface MotionBase {
  af: number;
  bc: number;
  de: number;
  hl: number;
  sp: number;
  pc: number;
  ix: number;
  iy: number;
  waiting: number;
  outLength: number;
  /** Four bytes at PC, captured before the step. Indexed shifts are not reliable in the disassembly text. */
  opcodes: readonly [number, number, number, number];
}

const NONE: MotionPlan = { type: "none" };

const REG_NAMES = new Set<string>([
  "a", "f", "b", "c", "d", "e", "h", "l", "i", "r", "ixh", "ixl", "iyh", "iyl",
  "af", "bc", "de", "hl", "sp", "ix", "iy", "pc",
]);

const BYTE_REGS = new Set<RegName>([
  "a", "f", "b", "c", "d", "e", "h", "l", "i", "r", "ixh", "ixl", "iyh", "iyl",
]);

type Operand =
  | { kind: "reg"; name: RegName }
  | { kind: "imm"; value: number }
  | { kind: "mem"; address: number }
  | { kind: "ind"; reg: "HL" | "BC" | "DE" | "SP" }
  | { kind: "idx"; reg: "IX" | "IY"; disp: number };

export function swapGroup(mnemonic: string): "af" | "exx" | undefined {
  const compact = mnemonic.replace(/\s+/g, "").toUpperCase();
  if (compact === "EXAF,AF'") {
    return "af";
  }
  if (compact === "EXX") {
    return "exx";
  }
  return undefined;
}

export function captureMotionBase(machine: Machine): MotionBase {
  const banks = machine.banks();
  const af = banks.main.afActive ? banks.main : banks.alternate;
  const exx = banks.main.exxActive ? banks.main : banks.alternate;
  const pc = machine.cpu.regs.pc & 0xffff;
  return {
    af: af.af & 0xffff,
    bc: exx.bc & 0xffff,
    de: exx.de & 0xffff,
    hl: exx.hl & 0xffff,
    sp: machine.cpu.regs.sp & 0xffff,
    pc,
    ix: machine.cpu.regs.ix & 0xffff,
    iy: machine.cpu.regs.iy & 0xffff,
    waiting: machine.console.waiting,
    outLength: machine.console.bytes.length,
    opcodes: [
      machine.memory[pc] ?? 0,
      machine.memory[(pc + 1) & 0xffff] ?? 0,
      machine.memory[(pc + 2) & 0xffff] ?? 0,
      machine.memory[(pc + 3) & 0xffff] ?? 0,
    ],
  };
}

export function planAfterStep(base: MotionBase, machine: Machine): MotionPlan {
  const banks = machine.banks();
  const af = banks.main.afActive ? banks.main : banks.alternate;
  const exx = banks.main.exxActive ? banks.main : banks.alternate;
  const grown = machine.console.bytes.slice(base.outLength);
  const mnemonic = machine.lastInstruction;
  const shift = planShift(base, machine);
  if (shift !== undefined) {
    return shift;
  }
  const bit = planBit(base, machine);
  if (bit !== undefined) {
    return bit;
  }
  const logic = planLogic(base, machine);
  if (logic !== undefined) {
    return logic;
  }
  const arith = planArith(base, machine);
  if (arith !== undefined) {
    return arith;
  }
  const word = planWord(base, machine);
  if (word !== undefined) {
    return word;
  }
  const daa = planDaa(base, machine);
  if (daa !== undefined) {
    return daa;
  }
  const nibble = planNibble(base, machine);
  if (nibble !== undefined) {
    return nibble;
  }
  const branch = planBranch(base, machine);
  if (branch !== undefined) {
    return branch;
  }
  const counter = planCounter(base, machine);
  if (counter !== undefined) {
    return counter;
  }
  return attachStackLabel(planMotion({
    mnemonic,
    a: hi(af.af),
    af: af.af & 0xffff,
    bc: exx.bc & 0xffff,
    de: exx.de & 0xffff,
    hl: exx.hl & 0xffff,
    sp: machine.cpu.regs.sp & 0xffff,
    pc: machine.cpu.regs.pc & 0xffff,
    ix: machine.cpu.regs.ix & 0xffff,
    iy: machine.cpu.regs.iy & 0xffff,
    i: machine.cpu.regs.i & 0xff,
    r: machine.refreshRegister(),
    spBefore: base.sp,
    pcBefore: base.pc,
    hlBefore: base.hl,
    bcBefore: base.bc,
    deBefore: base.de,
    ixBefore: base.ix,
    iyBefore: base.iy,
    writes: machine.writes,
    consoleOut: grown.length > 0 ? grown[grown.length - 1] & 0xff : undefined,
    consoleIn: readsConsole(mnemonic, base.bc, machine.console.waiting < base.waiting),
  }), machine, base.sp);
}

function attachStackLabel(plan: MotionPlan, machine: Machine, spBefore: number): MotionPlan {
  if (plan.type !== "travel" && plan.type !== "pair") {
    return plan;
  }
  const mnemonic = machine.lastInstruction.trim().toUpperCase();
  const pushOrCall = /^PUSH\b/.test(mnemonic) || /^CALL\b/.test(mnemonic) || /^RST\b/.test(mnemonic);
  const popOrRet = /^POP\b/.test(mnemonic) || /^RET\b/.test(mnemonic);
  const address = pushOrCall
    ? machine.cpu.regs.sp & 0xffff
    : popOrRet
      ? spBefore & 0xffff
      : undefined;
  if (address === undefined) {
    return plan;
  }
  const label = formatStackLabel(machine.stackWords.get(address));
  if (label === "") {
    return plan;
  }
  if (plan.type === "pair") {
    return plan.word.type === "mem" && plan.word.address === address ? { ...plan, label } : plan;
  }
  return {
    type: "travel",
    moves: plan.moves.map((move) => {
      const mem = move.to.type === "mem" ? move.to.address : move.from.type === "mem" ? move.from.address : undefined;
      return mem === address ? { ...move, label } : move;
    }),
  };
}

export function motionMemoryAddress(plan: MotionPlan): number | undefined {
  if ((plan.type === "shift" || plan.type === "bit" || plan.type === "counter") && plan.anchor.type === "mem") {
    return plan.anchor.address;
  }
  if (plan.type === "logic" && plan.other.type === "mem") {
    return plan.other.address;
  }
  if (plan.type === "alu" && plan.other.type === "mem") {
    return plan.other.address;
  }
  if (plan.type === "nibble") {
    return plan.address;
  }
  if (plan.type === "pair" && plan.word.type === "mem") {
    return plan.word.address;
  }
  if (plan.type !== "travel") {
    return undefined;
  }
  for (const move of plan.moves) {
    if (move.to.type === "mem") {
      return move.to.address;
    }
  }
  for (const move of plan.moves) {
    if (move.from.type === "mem") {
      return move.from.address;
    }
  }
  return undefined;
}

export function planMotion(facts: MotionFacts): MotionPlan {
  const mnemonic = facts.mnemonic.trim().toUpperCase();
  const group = swapGroup(mnemonic);
  if (group !== undefined) {
    return { type: "swap", group };
  }

  const compact = mnemonic.replace(/\s+/g, "");
  if (compact === "EXDE,HL") {
    return {
      type: "travel",
      moves: [
        carry(reg("de"), reg("hl"), facts.deBefore, 16),
        carry(reg("hl"), reg("de"), facts.hlBefore, 16),
      ],
    };
  }

  const exchange = /^EX\(SP\),(HL|IX|IY)$/.exec(compact);
  if (exchange) {
    const name = exchange[1].toLowerCase() as RegName;
    const before = name === "ix" ? facts.ixBefore : name === "iy" ? facts.iyBefore : facts.hlBefore;
    const after = valueOf(name, facts);
    const address = facts.spBefore & 0xffff;
    return {
      type: "travel",
      moves: [
        carry(reg(name), { type: "mem", address }, before, 16),
        carry({ type: "mem", address }, reg(name), after, 16),
      ],
    };
  }

  if (facts.consoleOut !== undefined) {
    return { type: "travel", moves: [carry(reg("a"), { type: "console" }, facts.consoleOut, 8, true)] };
  }
  if (facts.consoleIn && /^IN\s+A,/.test(mnemonic)) {
    return { type: "travel", moves: [carry({ type: "console" }, reg("a"), facts.a, 8)] };
  }

  const load = /^LD\s+(.+),(.+)$/.exec(mnemonic);
  if (load) {
    return planLoad(load[1], load[2], facts);
  }

  const push = /^PUSH\s+([A-Z]+)$/.exec(mnemonic);
  if (push) {
    const name = named(push[1]);
    if (name === undefined) {
      return NONE;
    }
    const address = (facts.spBefore - 2) & 0xffff;
    const parts = pairHalves(name);
    if (parts !== undefined) {
      return pairPlan("join", valueOf(name, facts), parts, { type: "mem", address });
    }
    return { type: "travel", moves: [carry(reg(name), { type: "mem", address }, valueOf(name, facts), widthOf(name))] };
  }

  const pop = /^POP\s+([A-Z]+)$/.exec(mnemonic);
  if (pop) {
    const name = named(pop[1]);
    if (name === undefined) {
      return NONE;
    }
    const address = facts.spBefore & 0xffff;
    const parts = pairHalves(name);
    if (parts !== undefined) {
      return pairPlan("split", valueOf(name, facts), parts, { type: "mem", address });
    }
    return { type: "travel", moves: [carry({ type: "mem", address }, reg(name), valueOf(name, facts), widthOf(name))] };
  }

  if (/^CALL\b/.test(mnemonic) && stackDelta(facts) === -2) {
    const address = (facts.spBefore - 2) & 0xffff;
    const value = writtenWord(facts.writes, address);
    if (value !== undefined) {
      return { type: "travel", moves: [carry(reg("pc"), { type: "mem", address }, value, 16)] };
    }
  }

  if (/^RET\b/.test(mnemonic) && stackDelta(facts) === 2) {
    const address = facts.spBefore & 0xffff;
    return { type: "travel", moves: [carry({ type: "mem", address }, reg("pc"), facts.pc, 16)] };
  }

  if (mnemonic === "LDI" || mnemonic === "LDD" || mnemonic === "LDIR" || mnemonic === "LDDR") {
    if (facts.writes.length !== 1) {
      return NONE;
    }
    const write = facts.writes[0];
    return {
      type: "travel",
      moves: [carry(
        { type: "mem", address: facts.hlBefore & 0xffff },
        { type: "mem", address: write.address },
        write.value,
        8,
      )],
    };
  }

  return NONE;
}

function planLoad(destText: string, srcText: string, facts: MotionFacts): MotionPlan {
  const dest = parseOperand(destText);
  const src = parseOperand(srcText);
  if (dest === undefined || src === undefined) {
    return NONE;
  }
  const intoPair = dest.kind === "reg" ? pairHalves(dest.name) : undefined;
  if (intoPair !== undefined && src.kind !== "reg") {
    const from = place(src, facts);
    if (from === undefined) {
      return NONE;
    }
    const value = src.kind === "imm" ? src.value : valueOf(dest.name, facts);
    return pairPlan("split", value, intoPair, from);
  }
  const fromPair = src.kind === "reg" ? pairHalves(src.name) : undefined;
  if (fromPair !== undefined && dest.kind !== "reg") {
    const to = place(dest, facts);
    if (to === undefined) {
      return NONE;
    }
    return pairPlan("join", valueOf(src.name, facts), fromPair, to);
  }
  const from = place(src, facts);
  const to = place(dest, facts);
  if (from === undefined || to === undefined) {
    return NONE;
  }
  const width = dest.kind === "reg" ? widthOf(dest.name) : src.kind === "reg" ? widthOf(src.name) : 8;
  const value = src.kind === "imm"
    ? src.value
    : src.kind === "reg"
      ? valueOf(src.name, facts)
      : dest.kind === "reg"
        ? valueOf(dest.name, facts)
        : 0;
  return { type: "travel", moves: [carry(from, to, value, width)] };
}

function place(operand: Operand, facts: MotionFacts): Anchor | undefined {
  if (operand.kind === "reg") {
    return reg(operand.name);
  }
  if (operand.kind === "imm") {
    return { type: "source" };
  }
  const address = addressOf(operand, facts);
  if (address === undefined) {
    return undefined;
  }
  return { type: "mem", address };
}

function addressOf(operand: Operand, facts: MotionFacts): number | undefined {
  if (operand.kind === "mem") {
    return operand.address & 0xffff;
  }
  if (operand.kind === "ind") {
    if (operand.reg === "HL") {
      return facts.hlBefore & 0xffff;
    }
    if (operand.reg === "BC") {
      return facts.bcBefore & 0xffff;
    }
    if (operand.reg === "DE") {
      return facts.deBefore & 0xffff;
    }
    return facts.spBefore & 0xffff;
  }
  if (operand.kind === "idx") {
    const base = operand.reg === "IX" ? facts.ixBefore : facts.iyBefore;
    const disp = operand.disp >= 0x80 ? operand.disp - 0x100 : operand.disp;
    return (base + disp) & 0xffff;
  }
  return undefined;
}

function parseOperand(raw: string): Operand | undefined {
  const text = raw.trim().toUpperCase();
  const indexed = /^\((IX|IY)([+-])(0X[0-9A-F]+)\)$/.exec(text);
  if (indexed) {
    const magnitude = Number.parseInt(indexed[3].slice(2), 16) & 0xff;
    const disp = indexed[2] === "-" ? (-magnitude & 0xff) : magnitude;
    return { kind: "idx", reg: indexed[1] as "IX" | "IY", disp };
  }
  const direct = /^\((0X[0-9A-F]+)\)$/.exec(text);
  if (direct) {
    return { kind: "mem", address: Number.parseInt(direct[1].slice(2), 16) & 0xffff };
  }
  const indirect = /^\((HL|BC|DE|SP)\)$/.exec(text);
  if (indirect) {
    return { kind: "ind", reg: indirect[1] as "HL" | "BC" | "DE" | "SP" };
  }
  if (/^0X[0-9A-F]+$/.test(text)) {
    return { kind: "imm", value: Number.parseInt(text.slice(2), 16) };
  }
  return named(text) === undefined ? undefined : { kind: "reg", name: named(text) as RegName };
}

function named(text: string): RegName | undefined {
  const name = text.trim().toLowerCase();
  return REG_NAMES.has(name) ? name as RegName : undefined;
}

function reg(name: RegName): Anchor {
  return { type: "reg", name };
}

/** The two bytes a pair is drawn as. SP and PC stay whole addresses. */
export function pairHalves(name: RegName): { high: RegName; low: RegName } | undefined {
  switch (name) {
    case "af":
      return { high: "a", low: "f" };
    case "bc":
      return { high: "b", low: "c" };
    case "de":
      return { high: "d", low: "e" };
    case "hl":
      return { high: "h", low: "l" };
    case "ix":
      return { high: "ixh", low: "ixl" };
    case "iy":
      return { high: "iyh", low: "iyl" };
    default:
      return undefined;
  }
}

function pairPlan(
  dir: "split" | "join",
  value: number,
  parts: { high: RegName; low: RegName },
  word: Anchor,
): PairMotion {
  const wordValue = value & 0xffff;
  return {
    type: "pair",
    dir,
    value: wordValue,
    high: (wordValue >> 8) & 0xff,
    low: wordValue & 0xff,
    highReg: parts.high,
    lowReg: parts.low,
    word,
  };
}

function widthOf(name: RegName): 8 | 16 {
  return BYTE_REGS.has(name) ? 8 : 16;
}

function valueOf(name: RegName, facts: MotionFacts): number {
  switch (name) {
    case "a":
      return facts.a;
    case "f":
      return facts.af & 0xff;
    case "b":
      return (facts.bc >> 8) & 0xff;
    case "c":
      return facts.bc & 0xff;
    case "d":
      return (facts.de >> 8) & 0xff;
    case "e":
      return facts.de & 0xff;
    case "h":
      return (facts.hl >> 8) & 0xff;
    case "l":
      return facts.hl & 0xff;
    case "i":
      return facts.i;
    case "r":
      return facts.r;
    case "af":
      return facts.af;
    case "bc":
      return facts.bc;
    case "de":
      return facts.de;
    case "hl":
      return facts.hl;
    case "sp":
      return facts.sp;
    case "ix":
      return facts.ix;
    case "iy":
      return facts.iy;
    case "ixh":
      return (facts.ix >> 8) & 0xff;
    case "ixl":
      return facts.ix & 0xff;
    case "iyh":
      return (facts.iy >> 8) & 0xff;
    case "iyl":
      return facts.iy & 0xff;
    case "pc":
      return facts.pc;
  }
}

function stackDelta(facts: MotionFacts): number {
  const dropped = (facts.spBefore - facts.sp) & 0xffff;
  if (dropped === 2) {
    return -2;
  }
  const lifted = (facts.sp - facts.spBefore) & 0xffff;
  if (lifted === 2) {
    return 2;
  }
  return 0;
}

function writtenWord(writes: readonly MemoryWrite[], address: number): number | undefined {
  const low = writes.find((write) => write.address === address);
  const high = writes.find((write) => write.address === ((address + 1) & 0xffff));
  if (low === undefined || high === undefined) {
    return undefined;
  }
  return (low.value | (high.value << 8)) & 0xffff;
}

function carry(from: Anchor, to: Anchor, value: number, width: 8 | 16, pop = false): Travel {
  const mask = width === 8 ? 0xff : 0xffff;
  return { from, to, value: value & mask, width, pop };
}

const SHIFT_KINDS: readonly ShiftKind[] = ["rlc", "rrc", "rl", "rr", "sla", "sra", "sll", "srl"];
const SHIFT_REGS: readonly RegName[] = ["b", "c", "d", "e", "h", "l", "a"];

/** Eight bits, slot 0 at the left (bit 7) and slot 7 at the right (bit 0). */
export function shiftTracks(kind: ShiftKind, before: number, carryBefore: boolean): ShiftTrack[] {
  const bits = Array.from({ length: 8 }, (_, slot) => ((before >> (7 - slot)) & 1) as 0 | 1);
  const carry: 0 | 1 = carryBefore ? 1 : 0;
  if (kind === "rlc" || kind === "rl" || kind === "sla" || kind === "sll") {
    return leftTracks(bits, carry, kind === "rlc" ? "wrap" : kind === "rl" ? "carry" : kind === "sll" ? 1 : 0);
  }
  return rightTracks(bits, carry, kind === "rrc" ? "wrap" : kind === "rr" ? "carry" : kind === "sra" ? "sign" : "zero");
}

function leftTracks(bits: Array<0 | 1>, carry: 0 | 1, fill: "wrap" | "carry" | 0 | 1): ShiftTrack[] {
  const tracks: ShiftTrack[] = [];
  const leaving = bits[0];
  if (fill === "wrap") {
    tracks.push({ value: leaving, from: "bit", fromSlot: 0, to: "bit", toSlot: 7 });
  }
  tracks.push({ value: leaving, from: "bit", fromSlot: 0, to: "carry" });
  for (let slot = 1; slot <= 7; slot++) {
    tracks.push({ value: bits[slot], from: "bit", fromSlot: slot, to: "bit", toSlot: slot - 1 });
  }
  if (fill === "carry") {
    tracks.push({ value: carry, from: "carry", to: "bit", toSlot: 7 });
  } else if (fill === 0 || fill === 1) {
    tracks.push({ value: fill, from: "fill", to: "bit", toSlot: 7 });
  }
  return tracks;
}

function rightTracks(
  bits: Array<0 | 1>,
  carry: 0 | 1,
  fill: "wrap" | "carry" | "zero" | "sign",
): ShiftTrack[] {
  const tracks: ShiftTrack[] = [];
  const leaving = bits[7];
  if (fill === "wrap") {
    tracks.push({ value: leaving, from: "bit", fromSlot: 7, to: "bit", toSlot: 0 });
  }
  tracks.push({ value: leaving, from: "bit", fromSlot: 7, to: "carry" });
  if (fill === "sign") {
    tracks.push({ value: bits[0], from: "bit", fromSlot: 0, to: "bit", toSlot: 0 });
    tracks.push({ value: bits[0], from: "bit", fromSlot: 0, to: "bit", toSlot: 1 });
    for (let slot = 1; slot <= 6; slot++) {
      tracks.push({ value: bits[slot], from: "bit", fromSlot: slot, to: "bit", toSlot: slot + 1 });
    }
    return tracks;
  }
  for (let slot = 0; slot <= 6; slot++) {
    tracks.push({ value: bits[slot], from: "bit", fromSlot: slot, to: "bit", toSlot: slot + 1 });
  }
  if (fill === "carry") {
    tracks.push({ value: carry, from: "carry", to: "bit", toSlot: 0 });
  } else if (fill === "zero") {
    tracks.push({ value: 0, from: "fill", to: "bit", toSlot: 0 });
  }
  return tracks;
}

function readCb(base: MotionBase): { op: number; memory: number | undefined } | undefined {
  const [b0, b1, b2, b3] = base.opcodes;
  if (b0 === 0xcb) {
    return { op: b1, memory: undefined };
  }
  if ((b0 === 0xdd || b0 === 0xfd) && b1 === 0xcb) {
    const disp = b2 >= 0x80 ? b2 - 0x100 : b2;
    const index = b0 === 0xdd ? base.ix : base.iy;
    return { op: b3, memory: (index + disp) & 0xffff };
  }
  return undefined;
}

function cbAnchor(
  field: number,
  memory: number | undefined,
  base: MotionBase,
): ShiftMotion["anchor"] {
  if (memory !== undefined || field === 6) {
    return { type: "mem", address: memory !== undefined ? memory : base.hl & 0xffff };
  }
  return { type: "reg", name: SHIFT_REGS[field < 6 ? field : 6] };
}

function planShift(base: MotionBase, machine: Machine): ShiftMotion | undefined {
  const [b0] = base.opcodes;
  if (b0 === 0x07 || b0 === 0x0f || b0 === 0x17 || b0 === 0x1f) {
    const kind: ShiftKind = b0 === 0x07 ? "rlc" : b0 === 0x0f ? "rrc" : b0 === 0x17 ? "rl" : "rr";
    return describeShift(kind, { type: "reg", name: "a" }, false, base, machine);
  }
  const decoded = readCb(base);
  if (decoded === undefined || (decoded.op & 0xc0) !== 0) {
    return undefined;
  }
  const kind = SHIFT_KINDS[(decoded.op >> 3) & 7];
  return describeShift(kind, cbAnchor(decoded.op & 7, decoded.memory, base), true, base, machine);
}

function planBit(base: MotionBase, machine: Machine): BitMotion | undefined {
  const decoded = readCb(base);
  if (decoded === undefined) {
    return undefined;
  }
  const group = decoded.op & 0xc0;
  const op: BitOp | undefined = group === 0x40 ? "bit" : group === 0x80 ? "res" : group === 0xc0 ? "set" : undefined;
  if (op === undefined) {
    return undefined;
  }
  const banks = machine.banks();
  const afBank = banks.main.afActive ? banks.main : banks.alternate;
  const flags = afBank.af & 0xff;
  const anchor = cbAnchor(decoded.op & 7, decoded.memory, base);
  const bytes = operandBytes(anchor, base, machine);
  return {
    type: "bit",
    anchor,
    before: bytes.before,
    after: bytes.after,
    bit: (decoded.op >> 3) & 7,
    op,
    zeroBefore: (base.af & 0x40) !== 0,
    zeroAfter: (flags & 0x40) !== 0,
  };
}

function describeShift(
  kind: ShiftKind,
  anchor: ShiftMotion["anchor"],
  flagsFromResult: boolean,
  base: MotionBase,
  machine: Machine,
): ShiftMotion {
  const banks = machine.banks();
  const afBank = banks.main.afActive ? banks.main : banks.alternate;
  const flags = afBank.af & 0xff;
  const bytes = operandBytes(anchor, base, machine);
  return {
    type: "shift",
    anchor,
    before: bytes.before,
    after: bytes.after,
    carryBefore: (base.af & 1) !== 0,
    carryAfter: (flags & 1) !== 0,
    kind,
    flagsFromResult,
    sign: (flags & 0x80) !== 0,
    zero: (flags & 0x40) !== 0,
    parity: (flags & 0x04) !== 0,
  };
}

function operandBytes(
  anchor: ShiftMotion["anchor"],
  base: MotionBase,
  machine: Machine,
): { before: number; after: number } {
  if (anchor.type === "mem") {
    const write = machine.writes.find((item) => item.address === anchor.address);
    return {
      before: (write === undefined ? machine.memory[anchor.address] : write.previous) & 0xff,
      after: (write === undefined ? machine.memory[anchor.address] : write.value) & 0xff,
    };
  }
  const banks = machine.banks();
  const exxBank = banks.main.exxActive ? banks.main : banks.alternate;
  const afBank = banks.main.afActive ? banks.main : banks.alternate;
  const afterRegs = { af: afBank.af, bc: exxBank.bc, de: exxBank.de, hl: exxBank.hl };
  return {
    before: registerByte(anchor.name, base),
    after: registerByte(anchor.name, afterRegs),
  };
}

function registerByte(
  name: RegName,
  regs: { af: number; bc: number; de: number; hl: number },
): number {
  switch (name) {
    case "a":
      return (regs.af >> 8) & 0xff;
    case "b":
      return (regs.bc >> 8) & 0xff;
    case "c":
      return regs.bc & 0xff;
    case "d":
      return (regs.de >> 8) & 0xff;
    case "e":
      return regs.de & 0xff;
    case "h":
      return (regs.hl >> 8) & 0xff;
    case "l":
      return regs.hl & 0xff;
    default:
      return 0;
  }
}

const BYTE_FIELDS: readonly (RegName | "mem")[] = ["b", "c", "d", "e", "h", "l", "mem", "a"];
const PAIR_FIELDS: readonly RegName[] = ["bc", "de", "hl", "sp"];

/** Eight bits, slot 0 at the left (bit 7). The result row is the operation applied to each column. */
export function logicRows(op: LogicOp, left: number, right: number): { left: Array<0 | 1>; right: Array<0 | 1>; result: Array<0 | 1> } {
  const rows: { left: Array<0 | 1>; right: Array<0 | 1>; result: Array<0 | 1> } = { left: [], right: [], result: [] };
  for (let slot = 0; slot < 8; slot++) {
    const bit = ((left >> (7 - slot)) & 1) as 0 | 1;
    const other = ((right >> (7 - slot)) & 1) as 0 | 1;
    const value = op === "and" ? bit & other : op === "or" ? bit | other : bit ^ other;
    rows.left.push(bit);
    rows.right.push(other);
    rows.result.push(value as 0 | 1);
  }
  return rows;
}

/** Digits of the selected format. ASCII rolls as hex. Decimal is zero-padded so every wheel is 0–9. */
export function counterDigits(
  before: number,
  after: number,
  format: DisplayFormat,
  width: 8 | 16,
  dir: CounterDir,
): { alphabet: string; from: string; to: string; wheels: CounterWheel[] } {
  const alphabet = format === "decimal" ? "0123456789" : format === "binary" ? "01" : "0123456789ABCDEF";
  const places = format === "decimal" ? (width === 8 ? 3 : 5) : format === "binary" ? width : (width === 8 ? 2 : 4);
  const radix = format === "decimal" ? 10 : format === "binary" ? 2 : 16;
  const mask = width === 8 ? 0xff : 0xffff;
  const from = (before & mask).toString(radix).toUpperCase().padStart(places, "0");
  const to = (after & mask).toString(radix).toUpperCase().padStart(places, "0");
  const wheels = [...from].map((glyph, index) => {
    const next = to[index] ?? glyph;
    const path = rollPath(alphabet, glyph, next, dir);
    return { from: glyph, to: next, turns: pathCrosses(alphabet, glyph, next, dir), path };
  });
  return { alphabet, from, to, wheels };
}

function rollPath(alphabet: string, from: string, to: string, dir: CounterDir): string[] {
  const start = alphabet.indexOf(from);
  const end = alphabet.indexOf(to);
  if (start < 0 || end < 0 || start === end) {
    return [from];
  }
  const path = [from];
  const step = dir === "inc" ? 1 : -1;
  let index = start;
  while (alphabet[index] !== to && path.length <= alphabet.length) {
    index = (index + step + alphabet.length) % alphabet.length;
    path.push(alphabet[index] ?? to);
  }
  return path;
}

function pathCrosses(alphabet: string, from: string, to: string, dir: CounterDir): boolean {
  const start = alphabet.indexOf(from);
  const end = alphabet.indexOf(to);
  if (start < 0 || end < 0 || start === end) {
    return false;
  }
  return dir === "inc" ? end < start : end > start;
}

interface OpcodeView {
  op: number;
  imm?: number;
  disp?: number;
  index?: "ix" | "iy";
}

function readOpcode(base: MotionBase): OpcodeView | undefined {
  const [b0, b1, b2] = base.opcodes;
  if (b0 === 0xed || b0 === 0xcb) {
    return undefined;
  }
  if (b0 === 0xdd || b0 === 0xfd) {
    if (b1 === 0xcb || b1 === 0xed || b1 === 0xdd || b1 === 0xfd) {
      return undefined;
    }
    const index = b0 === 0xdd ? "ix" : "iy";
    if (indexedMemoryOpcode(b1)) {
      return { op: b1, disp: b2 >= 0x80 ? b2 - 0x100 : b2, index };
    }
    return { op: b1, index, imm: immediateAluOpcode(b1) ? b2 : undefined };
  }
  return { op: b0, imm: immediateAluOpcode(b0) ? b1 : undefined };
}

function indexedMemoryOpcode(op: number): boolean {
  return op === 0x34 || op === 0x35 || (op & 0xc7) === 0x86;
}

function immediateAluOpcode(op: number): boolean {
  return (op & 0xc7) === 0xc6;
}

function logicKind(op: number): LogicOp | undefined {
  if ((op >= 0xa0 && op <= 0xa7) || op === 0xe6) {
    return "and";
  }
  if ((op >= 0xa8 && op <= 0xaf) || op === 0xee) {
    return "xor";
  }
  if ((op >= 0xb0 && op <= 0xb7) || op === 0xf6) {
    return "or";
  }
  return undefined;
}

/** Decimal places, ones first. A carry or borrow leaves each digit for the next. */
export function arithColumns(
  op: ArithOp | WordOp,
  left: number,
  right: number,
  carryFlag: boolean,
  places = 3,
): ArithColumn[] {
  const subtract = op === "sub" || op === "sbc" || op === "cp";
  const useCarry = op === "adc" || op === "sbc";
  let carry: 0 | 1 = useCarry && carryFlag ? 1 : 0;
  const columns: ArithColumn[] = [];
  for (let place = 0; place < places; place += 1) {
    const factor = 10 ** place;
    const l = Math.floor(Math.abs(left) / factor) % 10;
    const r = Math.floor(Math.abs(right) / factor) % 10;
    const total = subtract ? l - r - carry : l + r + carry;
    const digit = total < 0 ? total + 10 : total % 10;
    const carryOut: 0 | 1 = subtract ? (total < 0 ? 1 : 0) : (total >= 10 ? 1 : 0);
    columns.push({ place, left: l, right: r, carryIn: carry, digit, carryOut });
    carry = carryOut;
  }
  return columns;
}

/** The number written by the decimal digits. A final carry is the next place, not part of this sum. */
export function arithResult(columns: readonly ArithColumn[]): number {
  return columns.reduce((result, column) => result + column.digit * 10 ** column.place, 0);
}

/** The correction this emulator adds, or subtracts when N is set. */
export function daaAdjust(
  before: number,
  flags: { h: boolean; n: boolean; c: boolean },
): { correction: number; after: number; subtract: boolean; low: boolean; high: boolean } {
  const low = flags.h || (before & 0x0f) > 9;
  const high = flags.c || before > 0x99;
  let correction = 0;
  if (low) {
    correction |= 0x06;
  }
  if (high) {
    correction |= 0x60;
  }
  const after = flags.n ? (before - correction) & 0xff : (before + correction) & 0xff;
  return { correction, after, subtract: flags.n, low, high };
}

/** RLD moves each nibble left across A-low, (HL)-high, and (HL)-low. RRD moves them right. */
export function nibbleRotate(op: "rld" | "rrd", a: number, mem: number): { a: number; mem: number } {
  const aHigh = a & 0xf0;
  const aLow = a & 0x0f;
  const memHigh = (mem >> 4) & 0x0f;
  const memLow = mem & 0x0f;
  if (op === "rld") {
    return { a: aHigh | memHigh, mem: (memLow << 4) | aLow };
  }
  return { a: aHigh | memLow, mem: (aLow << 4) | memHigh };
}

function planArith(base: MotionBase, machine: Machine): ArithMotion | undefined {
  const decoded = readOpcode(base);
  if (decoded === undefined) {
    return undefined;
  }
  const op = arithKind(decoded.op);
  if (op === undefined) {
    return undefined;
  }
  const banks = machine.banks();
  const afBank = banks.main.afActive ? banks.main : banks.alternate;
  const left = (base.af >> 8) & 0xff;
  const carryFlag = (base.af & 0x01) !== 0;
  let right = 0;
  let other: ArithMotion["other"];
  if (decoded.imm !== undefined && immediateAluOpcode(decoded.op)) {
    right = decoded.imm & 0xff;
    other = { type: "source" };
  } else {
    const field = decoded.op & 7;
    if (decoded.index !== undefined && (field === 4 || field === 5)) {
      return undefined;
    }
    if (field === 6) {
      const address = memoryAddress(decoded, base);
      right = operandBytes({ type: "mem", address }, base, machine).before;
      other = { type: "mem", address };
    } else {
      const name = BYTE_FIELDS[field];
      if (name === undefined || name === "mem") {
        return undefined;
      }
      right = registerByte(name, base);
      other = { type: "reg", name };
    }
  }
  const columns = arithColumns(op, left, right, carryFlag, 3);
  const stored = (afBank.af >> 8) & 0xff;
  return {
    type: "alu",
    op,
    left,
    right,
    result: op === "cp" ? (left - right) & 0xff : stored,
    stored: op !== "cp",
    columns,
    other,
    dest: { type: "reg", name: "a" },
    flags: flagsOf(afBank.af),
  };
}

function arithKind(op: number): ArithOp | undefined {
  if ((op >= 0x80 && op <= 0x87) || op === 0xc6) {
    return "add";
  }
  if ((op >= 0x88 && op <= 0x8f) || op === 0xce) {
    return "adc";
  }
  if ((op >= 0x90 && op <= 0x97) || op === 0xd6) {
    return "sub";
  }
  if ((op >= 0x98 && op <= 0x9f) || op === 0xde) {
    return "sbc";
  }
  if ((op >= 0xb8 && op <= 0xbf) || op === 0xfe) {
    return "cp";
  }
  return undefined;
}

function planWord(base: MotionBase, machine: Machine): WordMotion | undefined {
  const [b0, b1] = base.opcodes;
  let op: WordOp;
  let pair: number;
  let dest: RegName;
  if (b0 === 0xed && (b1 & 0xcf) === 0x4a) {
    op = "adc";
    dest = "hl";
    pair = (b1 >> 4) & 3;
  } else if (b0 === 0xed && (b1 & 0xcf) === 0x42) {
    op = "sbc";
    dest = "hl";
    pair = (b1 >> 4) & 3;
  } else if ((b0 === 0xdd || b0 === 0xfd) && (b1 & 0xcf) === 0x09) {
    op = "add";
    dest = b0 === 0xdd ? "ix" : "iy";
    pair = (b1 >> 4) & 3;
  } else if ((b0 & 0xcf) === 0x09) {
    op = "add";
    dest = "hl";
    pair = (b0 >> 4) & 3;
  } else {
    return undefined;
  }
  const other: RegName = dest !== "hl" && pair === 2 ? dest : PAIR_FIELDS[pair];
  const after = activeWords(machine);
  const left = wordValue(dest, base);
  const right = wordValue(other, base);
  const columns = arithColumns(op, left, right, (base.af & 0x01) !== 0, 5);
  const banks = machine.banks();
  const afBank = banks.main.afActive ? banks.main : banks.alternate;
  return {
    type: "word",
    op,
    dest,
    other,
    left,
    right,
    result: wordValue(dest, after),
    columns,
    flags: flagsOf(afBank.af),
  };
}

function planDaa(base: MotionBase, machine: Machine): DaaMotion | undefined {
  if (base.opcodes[0] !== 0x27) {
    return undefined;
  }
  const before = (base.af >> 8) & 0xff;
  const h = (base.af & 0x10) !== 0;
  const n = (base.af & 0x02) !== 0;
  const c = (base.af & 0x01) !== 0;
  const adjusted = daaAdjust(before, { h, n, c });
  const banks = machine.banks();
  const afBank = banks.main.afActive ? banks.main : banks.alternate;
  return {
    type: "daa",
    before,
    after: (afBank.af >> 8) & 0xff,
    correction: adjusted.correction,
    subtract: adjusted.subtract,
    low: adjusted.low,
    high: adjusted.high,
    h,
    n,
    c,
    flags: flagsOf(afBank.af),
  };
}

function planNibble(base: MotionBase, machine: Machine): NibbleMotion | undefined {
  if (base.opcodes[0] !== 0xed) {
    return undefined;
  }
  const op = base.opcodes[1] === 0x6f ? "rld" : base.opcodes[1] === 0x67 ? "rrd" : undefined;
  if (op === undefined) {
    return undefined;
  }
  const address = base.hl & 0xffff;
  const banks = machine.banks();
  const afBank = banks.main.afActive ? banks.main : banks.alternate;
  const aAfter = (afBank.af >> 8) & 0xff;
  const memAfter = machine.memory[address] ?? 0;
  const restored = nibbleRotate(op === "rld" ? "rrd" : "rld", aAfter, memAfter);
  return {
    type: "nibble",
    op,
    aBefore: restored.a,
    aAfter,
    memBefore: restored.mem,
    memAfter,
    address,
    flags: flagsOf(afBank.af),
  };
}

function planBranch(base: MotionBase, machine: Machine): BranchMotion | undefined {
  const opcode = base.opcodes[0];
  const kind = opcode === 0x10
    ? "djnz"
    : opcode === 0x18 || opcode === 0x20 || opcode === 0x28 || opcode === 0x30 || opcode === 0x38
      ? "jr"
      : undefined;
  if (kind === undefined) {
    return undefined;
  }
  const displacement = base.opcodes[1] >= 0x80 ? base.opcodes[1] - 0x100 : base.opcodes[1];
  const next = (base.pc + 2) & 0xffff;
  const target = (next + displacement) & 0xffff;
  const taken = (machine.cpu.regs.pc & 0xffff) === target;
  const banks = machine.banks();
  const exx = banks.main.exxActive ? banks.main : banks.alternate;
  const plan: BranchMotion = {
    type: "branch",
    kind,
    taken,
    displacement,
    fromLine: machine.sourceLine(base.pc),
    toLine: taken ? machine.sourceLine(target) : undefined,
  };
  if (kind === "djnz") {
    plan.before = (base.bc >> 8) & 0xff;
    plan.after = (exx.bc >> 8) & 0xff;
  }
  return plan;
}

function flagsOf(af: number): FlagPicture {
  return {
    s: (af & 0x80) !== 0,
    z: (af & 0x40) !== 0,
    h: (af & 0x10) !== 0,
    pv: (af & 0x04) !== 0,
    n: (af & 0x02) !== 0,
    c: (af & 0x01) !== 0,
  };
}

function planLogic(base: MotionBase, machine: Machine): LogicMotion | undefined {
  const decoded = readOpcode(base);
  if (decoded === undefined) {
    return undefined;
  }
  const op = logicKind(decoded.op);
  if (op === undefined) {
    return undefined;
  }
  const banks = machine.banks();
  const afBank = banks.main.afActive ? banks.main : banks.alternate;
  const left = (base.af >> 8) & 0xff;
  const result = (afBank.af >> 8) & 0xff;
  if (decoded.imm !== undefined && (decoded.op === 0xe6 || decoded.op === 0xee || decoded.op === 0xf6)) {
    return { type: "logic", op, left, right: decoded.imm & 0xff, result, other: { type: "source" }, dest: { type: "reg", name: "a" } };
  }
  const field = decoded.op & 7;
  if (decoded.index !== undefined && (field === 4 || field === 5)) {
    return undefined;
  }
  if (field === 6) {
    const address = memoryAddress(decoded, base);
    const bytes = operandBytes({ type: "mem", address }, base, machine);
    return {
      type: "logic",
      op,
      left,
      right: bytes.before,
      result,
      other: { type: "mem", address },
      dest: { type: "reg", name: "a" },
    };
  }
  const name = BYTE_FIELDS[field];
  if (name === undefined || name === "mem") {
    return undefined;
  }
  return {
    type: "logic",
    op,
    left,
    right: registerByte(name, base),
    result,
    other: { type: "reg", name },
    dest: { type: "reg", name: "a" },
  };
}

function planCounter(base: MotionBase, machine: Machine): CounterMotion | undefined {
  const decoded = readOpcode(base);
  if (decoded === undefined) {
    return undefined;
  }
  const op = decoded.op;
  const inc8 = (op & 0xc7) === 0x04;
  const dec8 = (op & 0xc7) === 0x05;
  const inc16 = (op & 0xcf) === 0x03;
  const dec16 = (op & 0xcf) === 0x0b;
  if (!inc8 && !dec8 && !inc16 && !dec16) {
    return undefined;
  }
  const dir: CounterDir = inc8 || inc16 ? "inc" : "dec";
  if (inc8 || dec8) {
    const field = (op >> 3) & 7;
    if (decoded.index !== undefined && (field === 4 || field === 5)) {
      return undefined;
    }
    if (field === 6) {
      const address = memoryAddress(decoded, base);
      const bytes = operandBytes({ type: "mem", address }, base, machine);
      return { type: "counter", dir, width: 8, anchor: { type: "mem", address }, before: bytes.before, after: bytes.after };
    }
    const name = BYTE_FIELDS[field];
    if (name === undefined || name === "mem") {
      return undefined;
    }
    const banks = machine.banks();
    const exxBank = banks.main.exxActive ? banks.main : banks.alternate;
    const afBank = banks.main.afActive ? banks.main : banks.alternate;
    return {
      type: "counter",
      dir,
      width: 8,
      anchor: { type: "reg", name },
      before: registerByte(name, base),
      after: registerByte(name, { af: afBank.af, bc: exxBank.bc, de: exxBank.de, hl: exxBank.hl }),
    };
  }
  const pair = (op >> 4) & 3;
  const name: RegName = decoded.index !== undefined && pair === 2 ? decoded.index : PAIR_FIELDS[pair];
  const after = activeWords(machine);
  return {
    type: "counter",
    dir,
    width: 16,
    anchor: { type: "reg", name },
    before: wordValue(name, base),
    after: wordValue(name, after),
  };
}

function memoryAddress(decoded: OpcodeView, base: MotionBase): number {
  if (decoded.index === undefined) {
    return base.hl & 0xffff;
  }
  const index = decoded.index === "ix" ? base.ix : base.iy;
  return (index + (decoded.disp ?? 0)) & 0xffff;
}

function activeWords(machine: Machine): { bc: number; de: number; hl: number; sp: number; ix: number; iy: number } {
  const banks = machine.banks();
  const exx = banks.main.exxActive ? banks.main : banks.alternate;
  return {
    bc: exx.bc & 0xffff,
    de: exx.de & 0xffff,
    hl: exx.hl & 0xffff,
    sp: machine.cpu.regs.sp & 0xffff,
    ix: machine.cpu.regs.ix & 0xffff,
    iy: machine.cpu.regs.iy & 0xffff,
  };
}

function wordValue(name: RegName, regs: { bc: number; de: number; hl: number; sp: number; ix: number; iy: number }): number {
  switch (name) {
    case "bc":
      return regs.bc & 0xffff;
    case "de":
      return regs.de & 0xffff;
    case "hl":
      return regs.hl & 0xffff;
    case "sp":
      return regs.sp & 0xffff;
    case "ix":
      return regs.ix & 0xffff;
    case "iy":
      return regs.iy & 0xffff;
    default:
      return 0;
  }
}

function readsConsole(mnemonic: string, bcBefore: number, waitingDropped: boolean): boolean {
  const compact = mnemonic.replace(/\s+/g, "").toUpperCase();
  if (compact === "INA,(0X00)") {
    return true;
  }
  if (compact === "INA,(C)" && (bcBefore & 0xff) === 0) {
    return true;
  }
  return waitingDropped && /^IN\s+A,/i.test(mnemonic);
}
