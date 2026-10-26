import { hi } from "z80-base";
import type { Machine, MemoryWrite } from "./machine";
import { formatStackLabel } from "./stack";

/** A short trip, about half a second. Stepping again cancels whatever is still in the air. */
export const MOTION_MS = 520;

/** Pop the byte into bits, slide them, and land the leaving bit on Carry. */
export const SHIFT_MS = 900;

export type ShiftKind = "rlc" | "rrc" | "rl" | "rr" | "sla" | "sra" | "sll" | "srl";

export interface ShiftTrack {
  value: 0 | 1;
  from: "bit" | "carry" | "fill";
  fromSlot?: number;
  to: "bit" | "carry";
  toSlot?: number;
}

export type RegName =
  | "a" | "b" | "c" | "d" | "e" | "h" | "l" | "i" | "r"
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
  | ShiftMotion
  | BitMotion;

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
  "a", "b", "c", "d", "e", "h", "l", "i", "r", "af", "bc", "de", "hl", "sp", "ix", "iy", "pc",
]);

const BYTE_REGS = new Set<RegName>(["a", "b", "c", "d", "e", "h", "l", "i", "r"]);

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
  if (plan.type !== "travel") {
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
  return {
    type: "travel",
    moves: plan.moves.map((move) => {
      const mem = move.to.type === "mem" ? move.to.address : move.from.type === "mem" ? move.from.address : undefined;
      return mem === address ? { ...move, label } : move;
    }),
  };
}

export function motionMemoryAddress(plan: MotionPlan): number | undefined {
  if ((plan.type === "shift" || plan.type === "bit") && plan.anchor.type === "mem") {
    return plan.anchor.address;
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
    return { type: "travel", moves: [carry(reg(name), { type: "mem", address }, valueOf(name, facts), widthOf(name))] };
  }

  const pop = /^POP\s+([A-Z]+)$/.exec(mnemonic);
  if (pop) {
    const name = named(pop[1]);
    if (name === undefined) {
      return NONE;
    }
    const address = facts.spBefore & 0xffff;
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

function widthOf(name: RegName): 8 | 16 {
  return BYTE_REGS.has(name) ? 8 : 16;
}

function valueOf(name: RegName, facts: MotionFacts): number {
  switch (name) {
    case "a":
      return facts.a;
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
