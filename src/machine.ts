import { hi, lo } from "z80-base";
import { Z80, type Hal } from "z80-emulator";
import { assemble, type AssembleError } from "./assemble";
import { ConsoleDevice } from "./console";
import { disassembleAt } from "./disasm";
import { recordStackStep, type StackWord } from "./stack";

export const MEMORY_SIZE = 0x10000;

const OPCODE_EX_AF = 0x08;
const OPCODE_EXX = 0xd9;

export interface MemoryWrite {
  address: number;
  previous: number;
  value: number;
}

export interface RegisterBank {
  afActive: boolean;
  exxActive: boolean;
  af: number;
  bc: number;
  de: number;
  hl: number;
}

export interface Banks {
  main: RegisterBank;
  alternate: RegisterBank;
}

export interface MachineSnapshot {
  pc: number;
  sp: number;
  ix: number;
  iy: number;
  i: number;
  r: number;
  r7: number;
  memptr: number;
  iff1: number;
  iff2: number;
  im: number;
  halted: number;
  tStates: number;
  af: number;
  bc: number;
  de: number;
  hl: number;
  afPrime: number;
  bcPrime: number;
  dePrime: number;
  hlPrime: number;
  afAltActive: boolean;
  exxAltActive: boolean;
  memory: Uint8Array;
  steps: number;
  lastInstruction: string;
  writes: MemoryWrite[];
  lastWriteAddress: number | undefined;
  lastAccessAddress: number | undefined;
  lastAccessKind: "read" | "write" | undefined;
  consoleOutput: number[];
  consoleInput: number[];
  stackWords: [number, StackWord][];
  stackTouched: number[];
  changed: string[];
}

export class Machine {
  readonly memory = new Uint8Array(MEMORY_SIZE);
  readonly console = new ConsoleDevice();
  readonly cpu: Z80;
  readonly hal: Hal;

  origin = 0;
  ready = false;
  halted = false;
  steps = 0;
  errors: AssembleError[] = [];
  lastInstruction = "";
  nextInstruction = "NOP";
  writes: MemoryWrite[] = [];
  lastWriteAddress: number | undefined;
  lastAccessAddress: number | undefined;
  lastAccessKind: "read" | "write" | undefined;
  readonly changed = new Set<string>();
  readonly stackWords = new Map<number, StackWord>();
  readonly stackTouched = new Set<number>();

  private image: Uint8Array | null = null;
  private sourceLines: ReadonlyMap<number, number> = new Map();
  private afAltActive = false;
  private exxAltActive = false;
  private recording = false;
  private recorded: MemoryWrite[] = [];
  private accesses: { kind: "read" | "write"; address: number }[] = [];
  private history: MachineSnapshot[] = [];

  constructor() {
    const machine = this;
    this.hal = {
      tStateCount: 0,
      readMemory(address: number): number {
        const location = address & 0xffff;
        if (machine.recording) {
          machine.accesses.push({ kind: "read", address: location });
        }
        return machine.memory[location];
      },
      writeMemory(address: number, value: number): void {
        machine.store(address, value);
      },
      contendMemory(): void {},
      readPort(address: number): number {
        return machine.console.read(address);
      },
      writePort(address: number, value: number): void {
        machine.console.write(address, value);
      },
      contendPort(): void {},
    };
    this.cpu = new Z80(this.hal);
    this.refreshNext();
  }

  assemble(source: string): boolean {
    const result = assemble(source);
    if (!result.ok) {
      this.ready = false;
      this.errors = result.errors;
      this.changed.clear();
      return false;
    }
    this.image = result.image;
    this.origin = result.origin;
    this.sourceLines = result.sourceLines;
    this.errors = [];
    this.ready = true;
    this.reset();
    return true;
  }

  reset(): void {
    this.memory.fill(0);
    if (this.image) {
      this.memory.set(this.image);
    }
    this.cpu.reset();
    this.cpu.regs.pc = this.readyOrigin();
    this.hal.tStateCount = 0;
    this.afAltActive = false;
    this.exxAltActive = false;
    this.halted = false;
    this.steps = 0;
    this.lastInstruction = "";
    this.writes = [];
    this.lastWriteAddress = undefined;
    this.lastAccessAddress = undefined;
    this.lastAccessKind = undefined;
    this.changed.clear();
    this.stackWords.clear();
    this.stackTouched.clear();
    this.recording = false;
    this.recorded = [];
    this.accesses = [];
    this.history = [];
    this.console.clear();
    this.refreshNext();
  }

  clearConsole(): void {
    this.console.clear();
  }

  step(): void {
    if (!this.ready || this.halted) {
      return;
    }
    const before = this.viewKeys();
    const spBefore = this.cpu.regs.sp & 0xffff;
    const pc = this.cpu.regs.pc & 0xffff;
    const viewed = disassembleAt(this.memory, pc);
    const fetchCount = viewed.bytes.length;
    const opcode = this.memory[pc];
    this.history.push(this.snapshot());
    this.lastInstruction = viewed.text;
    this.recorded = [];
    this.accesses = [];
    this.recording = true;
    this.cpu.step();
    this.recording = false;
    this.noteOperandAccess(fetchCount);
    if (opcode === OPCODE_EX_AF) {
      this.afAltActive = !this.afAltActive;
    } else if (opcode === OPCODE_EXX) {
      this.exxAltActive = !this.exxAltActive;
    }
    this.halted = this.cpu.regs.halted !== 0;
    this.steps += 1;
    this.writes = collapseWrites(this.recorded);
    recordStackStep(
      this.stackWords,
      this.stackTouched,
      this.lastInstruction,
      spBefore,
      this.cpu.regs.sp & 0xffff,
      this.writes,
    );
    if (this.writes.length > 0) {
      this.lastWriteAddress = this.writes[this.writes.length - 1].address;
    }
    this.refreshNext();
    this.changed.clear();
    const after = this.viewKeys();
    for (const [key, value] of after) {
      if (before.get(key) !== value) {
        this.changed.add(key);
      }
    }
    if (before.get("main.afActive") !== after.get("main.afActive")) {
      this.changed.add("badge.main.af");
      this.changed.add("badge.alt.af");
    }
    if (before.get("main.exxActive") !== after.get("main.exxActive")) {
      this.changed.add("badge.main.exx");
      this.changed.add("badge.alt.exx");
    }
  }

  banks(): Banks {
    const regs = this.cpu.regs;
    const mainAf = this.afAltActive ? regs.afPrime : regs.af;
    const altAf = this.afAltActive ? regs.af : regs.afPrime;
    const mainBc = this.exxAltActive ? regs.bcPrime : regs.bc;
    const altBc = this.exxAltActive ? regs.bc : regs.bcPrime;
    const mainDe = this.exxAltActive ? regs.dePrime : regs.de;
    const altDe = this.exxAltActive ? regs.de : regs.dePrime;
    const mainHl = this.exxAltActive ? regs.hlPrime : regs.hl;
    const altHl = this.exxAltActive ? regs.hl : regs.hlPrime;
    return {
      main: {
        afActive: !this.afAltActive,
        exxActive: !this.exxAltActive,
        af: mainAf & 0xffff,
        bc: mainBc & 0xffff,
        de: mainDe & 0xffff,
        hl: mainHl & 0xffff,
      },
      alternate: {
        afActive: this.afAltActive,
        exxActive: this.exxAltActive,
        af: altAf & 0xffff,
        bc: altBc & 0xffff,
        de: altDe & 0xffff,
        hl: altHl & 0xffff,
      },
    };
  }

  /** Undo the last Step or run-to instruction. An edit is not its own step. */
  stepBack(): boolean {
    const previous = this.history.pop();
    if (previous === undefined) {
      return false;
    }
    this.restore(previous);
    return true;
  }

  canStepBack(): boolean {
    return this.history.length > 0;
  }

  sourceLine(address: number): number | undefined {
    return this.sourceLines.get(address & 0xffff);
  }

  hasSourceLine(line: number): boolean {
    for (const value of this.sourceLines.values()) {
      if (value === line) {
        return true;
      }
    }
    return false;
  }

  /**
   * Write a register as it is shown on screen. `main` and `alt` follow the
   * Active and Shadow banks, so editing F changes the flags of that bank.
   */
  setVisibleRegister(key: string, value: number): boolean {
    const regs = this.cpu.regs;
    const byte = value & 0xff;
    const wordValue = value & 0xffff;
    if (key === "pc") {
      regs.pc = wordValue;
      regs.halted = 0;
      this.halted = false;
    } else if (key === "sp") {
      regs.sp = wordValue;
    } else if (key === "ix" || key === "ixh" || key === "ixl") {
      regs.ix = key === "ixh"
        ? ((byte << 8) | (regs.ix & 0xff)) & 0xffff
        : key === "ixl"
          ? ((regs.ix & 0xff00) | byte) & 0xffff
          : wordValue;
    } else if (key === "iy" || key === "iyh" || key === "iyl") {
      regs.iy = key === "iyh"
        ? ((byte << 8) | (regs.iy & 0xff)) & 0xffff
        : key === "iyl"
          ? ((regs.iy & 0xff00) | byte) & 0xffff
          : wordValue;
    } else if (key === "i") {
      regs.i = byte;
    } else if (key === "r") {
      regs.r = byte;
      regs.r7 = byte & 0x80;
    } else {
      const match = /^(main|alt)\.(a|f|af|b|c|bc|d|e|de|h|l|hl)$/.exec(key);
      if (match === null) {
        return false;
      }
      const side = match[1];
      const part = match[2];
      if (part === "a" || part === "f" || part === "af") {
        writeBank(regs, "af", side === "main" ? this.afAltActive : !this.afAltActive, part, value);
      } else if (part === "b" || part === "c" || part === "bc") {
        writeBank(regs, "bc", side === "main" ? this.exxAltActive : !this.exxAltActive, part, value);
      } else if (part === "d" || part === "e" || part === "de") {
        writeBank(regs, "de", side === "main" ? this.exxAltActive : !this.exxAltActive, part, value);
      } else {
        writeBank(regs, "hl", side === "main" ? this.exxAltActive : !this.exxAltActive, part, value);
      }
    }
    this.changed.add(key);
    if (key.endsWith(".f")) {
      const side = key.startsWith("alt.") ? "alt" : "main";
      for (const flag of ["s", "z", "h", "pv", "n", "c"]) {
        this.changed.add(`${side}.flag.${flag}`);
      }
    }
    this.refreshNext();
    return true;
  }

  setMemoryByte(address: number, value: number): void {
    this.memory[address & 0xffff] = value & 0xff;
    this.refreshNext();
  }

  byte(register: number): number {
    return hi(register);
  }

  low(register: number): number {
    return lo(register);
  }

  refreshRegister(): number {
    return this.cpu.regs.r & 0xff;
  }

  snapshot(): MachineSnapshot {
    const regs = this.cpu.regs;
    const consoleState = this.console.capture();
    return {
      pc: regs.pc & 0xffff,
      sp: regs.sp & 0xffff,
      ix: regs.ix & 0xffff,
      iy: regs.iy & 0xffff,
      i: regs.i & 0xff,
      r: regs.r & 0xff,
      r7: regs.r7 & 0xff,
      memptr: regs.memptr & 0xffff,
      iff1: regs.iff1,
      iff2: regs.iff2,
      im: regs.im,
      halted: regs.halted,
      tStates: this.hal.tStateCount,
      af: regs.af & 0xffff,
      bc: regs.bc & 0xffff,
      de: regs.de & 0xffff,
      hl: regs.hl & 0xffff,
      afPrime: regs.afPrime & 0xffff,
      bcPrime: regs.bcPrime & 0xffff,
      dePrime: regs.dePrime & 0xffff,
      hlPrime: regs.hlPrime & 0xffff,
      afAltActive: this.afAltActive,
      exxAltActive: this.exxAltActive,
      memory: this.memory.slice(),
      steps: this.steps,
      lastInstruction: this.lastInstruction,
      writes: this.writes.map((write) => ({ ...write })),
      lastWriteAddress: this.lastWriteAddress,
      lastAccessAddress: this.lastAccessAddress,
      lastAccessKind: this.lastAccessKind,
      consoleOutput: consoleState.output,
      consoleInput: consoleState.input,
      stackWords: [...this.stackWords.entries()].map(([address, word]) => [address, { ...word }]),
      stackTouched: [...this.stackTouched],
      changed: [...this.changed],
    };
  }

  private restore(previous: MachineSnapshot): void {
    const regs = this.cpu.regs;
    regs.pc = previous.pc;
    regs.sp = previous.sp;
    regs.ix = previous.ix;
    regs.iy = previous.iy;
    regs.i = previous.i;
    regs.r = previous.r;
    regs.r7 = previous.r7;
    regs.memptr = previous.memptr;
    regs.iff1 = previous.iff1;
    regs.iff2 = previous.iff2;
    regs.im = previous.im;
    regs.halted = previous.halted;
    regs.af = previous.af;
    regs.bc = previous.bc;
    regs.de = previous.de;
    regs.hl = previous.hl;
    regs.afPrime = previous.afPrime;
    regs.bcPrime = previous.bcPrime;
    regs.dePrime = previous.dePrime;
    regs.hlPrime = previous.hlPrime;
    this.hal.tStateCount = previous.tStates;
    this.afAltActive = previous.afAltActive;
    this.exxAltActive = previous.exxAltActive;
    this.memory.set(previous.memory);
    this.steps = previous.steps;
    this.lastInstruction = previous.lastInstruction;
    this.writes = previous.writes.map((write) => ({ ...write }));
    this.lastWriteAddress = previous.lastWriteAddress;
    this.lastAccessAddress = previous.lastAccessAddress;
    this.lastAccessKind = previous.lastAccessKind;
    this.halted = previous.halted !== 0;
    this.console.restore({ output: previous.consoleOutput, input: previous.consoleInput });
    this.stackWords.clear();
    for (const [address, word] of previous.stackWords) {
      this.stackWords.set(address, { ...word });
    }
    this.stackTouched.clear();
    for (const address of previous.stackTouched) {
      this.stackTouched.add(address);
    }
    this.changed.clear();
    for (const key of previous.changed) {
      this.changed.add(key);
    }
    this.refreshNext();
  }

  private noteOperandAccess(fetchCount: number): void {
    let reads = 0;
    let last: { kind: "read" | "write"; address: number } | undefined;
    for (const access of this.accesses) {
      if (access.kind === "read") {
        reads += 1;
        if (reads <= fetchCount) {
          continue;
        }
      }
      last = access;
    }
    if (last !== undefined) {
      this.lastAccessAddress = last.address;
      this.lastAccessKind = last.kind;
    }
  }

  private readyOrigin(): number {
    return this.image ? this.origin & 0xffff : 0;
  }

  private store(address: number, value: number): void {
    const location = address & 0xffff;
    const next = value & 0xff;
    if (this.recording) {
      this.recorded.push({ address: location, previous: this.memory[location], value: next });
      this.accesses.push({ kind: "write", address: location });
    }
    this.memory[location] = next;
  }

  private refreshNext(): void {
    this.nextInstruction = disassembleAt(this.memory, this.cpu.regs.pc).text;
  }

  private viewKeys(): Map<string, number> {
    const keys = new Map<string, number>();
    const banks = this.banks();
    putBank(keys, "main", banks.main);
    putBank(keys, "alt", banks.alternate);
    const regs = this.cpu.regs;
    keys.set("pc", regs.pc & 0xffff);
    keys.set("sp", regs.sp & 0xffff);
    keys.set("ix", regs.ix & 0xffff);
    keys.set("ixh", (regs.ix >> 8) & 0xff);
    keys.set("ixl", regs.ix & 0xff);
    keys.set("iy", regs.iy & 0xffff);
    keys.set("iyh", (regs.iy >> 8) & 0xff);
    keys.set("iyl", regs.iy & 0xff);
    keys.set("i", regs.i & 0xff);
    keys.set("r", regs.r & 0xff);
    return keys;
  }
}

function writeBank(
  regs: {
    af: number;
    afPrime: number;
    bc: number;
    bcPrime: number;
    de: number;
    dePrime: number;
    hl: number;
    hlPrime: number;
  },
  pair: "af" | "bc" | "de" | "hl",
  prime: boolean,
  part: string,
  value: number,
): void {
  const field = prime ? `${pair}Prime` as const : pair;
  const current = regs[field] & 0xffff;
  const highPart = part === "a" || part === "b" || part === "d" || part === "h";
  let next = value & 0xffff;
  if (part.length === 1) {
    const byte = value & 0xff;
    next = highPart ? ((byte << 8) | (current & 0xff)) & 0xffff : ((current & 0xff00) | byte) & 0xffff;
  }
  regs[field] = next;
}

function putBank(keys: Map<string, number>, name: string, bank: RegisterBank): void {
  keys.set(`${name}.af`, bank.af & 0xffff);
  keys.set(`${name}.a`, hi(bank.af));
  keys.set(`${name}.f`, lo(bank.af));
  keys.set(`${name}.bc`, bank.bc & 0xffff);
  keys.set(`${name}.b`, hi(bank.bc));
  keys.set(`${name}.c`, lo(bank.bc));
  keys.set(`${name}.de`, bank.de & 0xffff);
  keys.set(`${name}.d`, hi(bank.de));
  keys.set(`${name}.e`, lo(bank.de));
  keys.set(`${name}.hl`, bank.hl & 0xffff);
  keys.set(`${name}.h`, hi(bank.hl));
  keys.set(`${name}.l`, lo(bank.hl));
  const flags = lo(bank.af);
  keys.set(`${name}.flag.s`, flags & 0x80);
  keys.set(`${name}.flag.z`, flags & 0x40);
  keys.set(`${name}.flag.h`, flags & 0x10);
  keys.set(`${name}.flag.pv`, flags & 0x04);
  keys.set(`${name}.flag.n`, flags & 0x02);
  keys.set(`${name}.flag.c`, flags & 0x01);
  keys.set(`${name}.afActive`, bank.afActive ? 1 : 0);
  keys.set(`${name}.exxActive`, bank.exxActive ? 1 : 0);
}

function collapseWrites(writes: MemoryWrite[]): MemoryWrite[] {
  const order: number[] = [];
  const byAddress = new Map<number, MemoryWrite>();
  for (const write of writes) {
    const existing = byAddress.get(write.address);
    if (existing === undefined) {
      byAddress.set(write.address, { ...write });
      order.push(write.address);
    } else {
      existing.value = write.value;
    }
  }
  return order
    .map((address) => byAddress.get(address))
    .filter((write): write is MemoryWrite => write !== undefined && write.previous !== write.value);
}
