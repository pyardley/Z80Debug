import { describe, expect, it } from "vitest";
import { assemble } from "./assemble";
import { disassembleAt } from "./disasm";
import {
  bytesPerRow,
  formatByte,
  formatWord,
  FORMAT_STORAGE_KEY,
  loadFormat,
  saveFormat,
} from "./format";
import { Machine } from "./machine";
import { SAMPLE_SOURCE } from "./sample";

function bytesAt(source: string, address: number, length: number): number[] {
  const result = assemble(source);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return [];
  }
  return Array.from(result.image.slice(address, address + length));
}

describe("assembler", () => {
  it("assembles documented instructions to the right bytes", () => {
    expect(bytesAt("NOP", 0, 1)).toEqual([0x00]);
    expect(bytesAt("LD A, 0C3H", 0, 2)).toEqual([0x3e, 0xc3]);
    expect(bytesAt("ld a, c", 0, 1)).toEqual([0x79]);
    expect(bytesAt("EXX", 0, 1)).toEqual([0xd9]);
    expect(bytesAt("EX AF, AF'", 0, 1)).toEqual([0x08]);
    expect(bytesAt("LD (0C000H), A", 0, 3)).toEqual([0x32, 0x00, 0xc0]);
    expect(bytesAt("ADD A, 0C4H", 0, 2)).toEqual([0xc6, 0xc4]);
    expect(bytesAt("LD BC, 1234H", 0, 3)).toEqual([0x01, 0x34, 0x12]);
  });

  it("accepts ORG, EQU, DB, DW, and DS", () => {
    const result = assemble(`
VALUE EQU 7
      ORG 200H
      DB VALUE, 0AAH
      DW 1234H
      DS 2, 0FFH
`);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.origin).toBe(0x200);
    expect(Array.from(result.image.slice(0x200, 0x206))).toEqual([0x07, 0xaa, 0x34, 0x12, 0xff, 0xff]);
  });

  it("names the line when assembly fails", () => {
    const result = assemble("NOP\nFOO\nLD A, 1\n");
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors[0]).toEqual({ line: 2, message: "unknown mnemonic: foo" });
  });
});

describe("stepping", () => {
  it("EXX swaps BC DE HL and leaves AF alone", () => {
    const machine = new Machine();
    expect(machine.assemble(`
      LD A, 11H
      LD BC, 1234H
      LD DE, 5678H
      LD HL, 9ABCH
      EXX
    `)).toBe(true);
    for (let count = 0; count < 4; count++) {
      machine.step();
    }
    const before = machine.banks();
    expect(before.main.afActive).toBe(true);
    expect(before.main.exxActive).toBe(true);
    expect(before.main.bc).toBe(0x1234);
    expect(before.main.af & 0xff00).toBe(0x1100);
    machine.step();
    const after = machine.banks();
    expect(after.main.exxActive).toBe(false);
    expect(after.alternate.exxActive).toBe(true);
    expect(after.main.bc).toBe(0x1234);
    expect(after.main.de).toBe(0x5678);
    expect(after.main.hl).toBe(0x9abc);
    expect(after.alternate.bc).toBe(0);
    expect(after.main.afActive).toBe(true);
    expect(after.alternate.afActive).toBe(false);
    expect(after.main.af & 0xff00).toBe(0x1100);
    expect(machine.cpu.regs.af & 0xff00).toBe(0x1100);
    expect(machine.cpu.regs.bc).toBe(0);
    expect(machine.cpu.regs.bcPrime).toBe(0x1234);
  });

  it("EX AF,AF' swaps only AF", () => {
    const machine = new Machine();
    expect(machine.assemble(`
      LD A, 11H
      LD B, 22H
      EX AF, AF'
      LD A, 33H
    `)).toBe(true);
    machine.step();
    machine.step();
    machine.step();
    const exchanged = machine.banks();
    expect(exchanged.main.afActive).toBe(false);
    expect(exchanged.alternate.afActive).toBe(true);
    expect(exchanged.main.af & 0xff00).toBe(0x1100);
    expect(exchanged.alternate.af & 0xff00).toBe(0);
    expect(exchanged.main.exxActive).toBe(true);
    expect(exchanged.main.bc & 0xff00).toBe(0x2200);
    machine.step();
    const written = machine.banks();
    expect(written.alternate.af & 0xff00).toBe(0x3300);
    expect(written.main.af & 0xff00).toBe(0x1100);
    expect(written.main.bc & 0xff00).toBe(0x2200);
    expect(written.main.exxActive).toBe(true);
  });

  it("keeps the two exchanges independent", () => {
    const machine = new Machine();
    expect(machine.assemble(`
      LD A, 11H
      LD B, 22H
      EX AF, AF'
      LD A, 33H
      EXX
      LD B, 44H
    `)).toBe(true);
    for (let count = 0; count < 6; count++) {
      machine.step();
    }
    const banks = machine.banks();
    expect(banks.main.afActive).toBe(false);
    expect(banks.alternate.afActive).toBe(true);
    expect(banks.main.exxActive).toBe(false);
    expect(banks.alternate.exxActive).toBe(true);
    expect(banks.main.af & 0xff00).toBe(0x1100);
    expect(banks.alternate.af & 0xff00).toBe(0x3300);
    expect(banks.main.bc & 0xff00).toBe(0x2200);
    expect(banks.alternate.bc & 0xff00).toBe(0x4400);
  });

  it("records a store and restores it on reset", () => {
    const machine = new Machine();
    expect(machine.assemble(`
      LD A, 5AH
      LD (0C000H), A
    `)).toBe(true);
    expect(machine.cpu.regs.pc).toBe(0);
    machine.step();
    machine.step();
    expect(machine.memory[0xc000]).toBe(0x5a);
    expect(machine.writes).toEqual([{ address: 0xc000, previous: 0, value: 0x5a }]);
    expect(machine.changed.has("alt.a")).toBe(false);
    machine.reset();
    expect(machine.memory[0xc000]).toBe(0);
    expect(machine.cpu.regs.a).toBe(0);
    expect(machine.writes).toEqual([]);
  });

  it("stops stepping when the CPU halts", () => {
    const machine = new Machine();
    expect(machine.assemble("HALT\nLD A, 1\n")).toBe(true);
    machine.step();
    expect(machine.halted).toBe(true);
    expect(machine.cpu.regs.a).toBe(0);
    machine.step();
    expect(machine.cpu.regs.a).toBe(0);
    expect(machine.steps).toBe(1);
  });

  it("runs the sample through EXX without moving the other bank", () => {
    const machine = new Machine();
    expect(machine.assemble(SAMPLE_SOURCE)).toBe(true);
    expect(machine.cpu.regs.pc).toBe(0x100);
    expect(machine.ready).toBe(true);
    for (let count = 0; count < 8; count++) {
      machine.step();
    }
    expect(machine.memory[0xc000]).toBe(0x3c);
    expect(machine.writes).toEqual([{ address: 0xc000, previous: 0, value: 0x3c }]);
    machine.step();
    expect(machine.cpu.regs.a).toBe(0);
    expect(machine.cpu.regs.f & 0xc1).toBe(0x41);
    machine.step();
    const afterAf = machine.banks();
    expect(afterAf.main.afActive).toBe(false);
    expect(afterAf.alternate.afActive).toBe(true);
    expect(afterAf.main.exxActive).toBe(true);
    expect(afterAf.alternate.exxActive).toBe(false);
    expect(afterAf.main.bc).toBe(0x1234);
    machine.step();
    const afterExx = machine.banks();
    expect(machine.lastInstruction).toBe("EXX");
    expect(afterExx.main.exxActive).toBe(false);
    expect(afterExx.alternate.exxActive).toBe(true);
    expect(afterExx.main.bc).toBe(0x1234);
    expect(afterExx.main.de).toBe(0x5678);
    expect(afterExx.main.hl).toBe(0x9abc);
    expect(afterExx.alternate.bc).toBe(0);
    expect(afterExx.main.afActive).toBe(false);
    expect(afterExx.alternate.afActive).toBe(true);
  });

  it("disables step until assembly succeeds", () => {
    const machine = new Machine();
    expect(machine.ready).toBe(false);
    machine.step();
    expect(machine.steps).toBe(0);
    expect(machine.assemble("NOT AN INSTRUCTION")).toBe(false);
    expect(machine.ready).toBe(false);
    expect(machine.errors[0]?.line).toBe(1);
  });
});

describe("display format", () => {
  it("uses a stable width and does not change machine state", () => {
    const machine = new Machine();
    expect(machine.assemble("LD A, 0C3H\nLD BC, 1234H\n")).toBe(true);
    machine.step();
    machine.step();
    const before = machine.snapshot();
    expect(formatByte(0xc3, "hex")).toBe("C3");
    expect(formatByte(0xc3, "decimal")).toBe("195");
    expect(formatByte(0xc3, "binary")).toBe("11000011");
    expect(formatByte(0, "binary")).toBe("00000000");
    expect(formatByte(5, "decimal")).toBe("  5");
    expect(formatWord(0x1234, "hex")).toBe("1234");
    expect(formatWord(0x1234, "decimal")).toBe(" 4660");
    expect(formatWord(0x1234, "binary")).toBe("0001001000110100");
    expect(formatWord(0, "binary")).toBe("0000000000000000");
    expect(bytesPerRow("hex")).toBe(16);
    expect(bytesPerRow("decimal")).toBe(8);
    expect(bytesPerRow("binary")).toBe(4);
    for (const format of ["hex", "decimal", "binary"] as const) {
      formatByte(machine.cpu.regs.a, format);
      formatWord(machine.cpu.regs.bc, format);
      formatWord(machine.cpu.regs.pc, format);
      formatByte(machine.memory[0], format);
    }
    expect(machine.snapshot()).toEqual(before);
  });

  it("persists the choice without touching registers", () => {
    const machine = new Machine();
    machine.assemble("LD A, 1");
    machine.step();
    const before = machine.snapshot();
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
    };
    expect(loadFormat(storage)).toBe("hex");
    saveFormat(storage, "binary");
    expect(stored.get(FORMAT_STORAGE_KEY)).toBe("binary");
    expect(loadFormat(storage)).toBe("binary");
    expect(machine.snapshot()).toEqual(before);
  });
});

describe("disassembler", () => {
  it("names the instruction at PC", () => {
    const memory = new Uint8Array(16);
    memory[0] = 0xd9;
    expect(disassembleAt(memory, 0).text).toBe("EXX");
    expect(disassembleAt(memory, 0).bytes).toEqual([0xd9]);
  });
});
