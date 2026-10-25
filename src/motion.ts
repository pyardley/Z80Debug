import { hi } from "z80-base";
import type { Machine, MemoryWrite } from "./machine";

/** A short trip, about half a second. Stepping again cancels whatever is still in the air. */
export const MOTION_MS = 520;

export type RegName =
  | "a" | "b" | "c" | "d" | "e" | "h" | "l" | "i" | "r"
  | "af" | "bc" | "de" | "hl" | "sp" | "ix" | "iy";

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
}

export type MotionPlan =
  | { type: "none" }
  | { type: "swap"; group: "af" | "exx" }
  | { type: "travel"; moves: Travel[] };

export interface MotionFacts {
  mnemonic: string;
  a: number;
  af: number;
  bc: number;
  de: number;
  hl: number;
  sp: number;
  ix: number;
  iy: number;
  i: number;
  r: number;
  spBefore: number;
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
  ix: number;
  iy: number;
  waiting: number;
  outLength: number;
}

const NONE: MotionPlan = { type: "none" };

const REG_NAMES = new Set<string>([
  "a", "b", "c", "d", "e", "h", "l", "i", "r", "af", "bc", "de", "hl", "sp", "ix", "iy",
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
  return {
    af: af.af & 0xffff,
    bc: exx.bc & 0xffff,
    de: exx.de & 0xffff,
    hl: exx.hl & 0xffff,
    sp: machine.cpu.regs.sp & 0xffff,
    ix: machine.cpu.regs.ix & 0xffff,
    iy: machine.cpu.regs.iy & 0xffff,
    waiting: machine.console.waiting,
    outLength: machine.console.bytes.length,
  };
}

export function planAfterStep(base: MotionBase, machine: Machine): MotionPlan {
  const banks = machine.banks();
  const af = banks.main.afActive ? banks.main : banks.alternate;
  const exx = banks.main.exxActive ? banks.main : banks.alternate;
  const grown = machine.console.bytes.slice(base.outLength);
  const mnemonic = machine.lastInstruction;
  return planMotion({
    mnemonic,
    a: hi(af.af),
    af: af.af & 0xffff,
    bc: exx.bc & 0xffff,
    de: exx.de & 0xffff,
    hl: exx.hl & 0xffff,
    sp: machine.cpu.regs.sp & 0xffff,
    ix: machine.cpu.regs.ix & 0xffff,
    iy: machine.cpu.regs.iy & 0xffff,
    i: machine.cpu.regs.i & 0xff,
    r: machine.refreshRegister(),
    spBefore: base.sp,
    hlBefore: base.hl,
    bcBefore: base.bc,
    deBefore: base.de,
    ixBefore: base.ix,
    iyBefore: base.iy,
    writes: machine.writes,
    consoleOut: grown.length > 0 ? grown[grown.length - 1] & 0xff : undefined,
    consoleIn: readsConsole(mnemonic, base.bc, machine.console.waiting < base.waiting),
  });
}

export function motionMemoryAddress(plan: MotionPlan): number | undefined {
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
  }
}

function carry(from: Anchor, to: Anchor, value: number, width: 8 | 16, pop = false): Travel {
  const mask = width === 8 ? 0xff : 0xffff;
  return { from, to, value: value & mask, width, pop };
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
