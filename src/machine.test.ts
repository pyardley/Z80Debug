import { describe, expect, it } from "vitest";
import { assemble } from "./assemble";
import { disassembleAt } from "./disasm";
import {
  ASCII_MIDDLE_DOT,
  bytesPerRow,
  formatByte,
  formatNames,
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

  it("maps each emitted address to the source line", () => {
    const source = [
      "VALUE EQU 1",
      "      ORG 10H",
      "above:",
      "      NOP",
      "      LD BC, 1234H",
    ].join("\n");
    const result = assemble(source);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.origin).toBe(0x10);
    expect(result.sourceLines.get(0x10)).toBe(4);
    expect(result.sourceLines.get(0x11)).toBe(5);
    expect(result.sourceLines.get(0x12)).toBe(5);
    expect(result.sourceLines.get(0x13)).toBe(5);
    expect(result.sourceLines.has(0)).toBe(false);
    expect(result.sourceLines.has(0x0f)).toBe(false);
    expect(result.sourceLines.has(0x14)).toBe(false);
    expect([...result.sourceLines.values()].includes(3)).toBe(false);
  });

  it("maps a label that shares its line with the instruction", () => {
    const result = assemble("loop: LD A, 1\n");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.sourceLines.get(0)).toBe(1);
    expect(result.sourceLines.get(1)).toBe(1);
    expect(result.sourceLines.has(2)).toBe(false);
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
    expect(machine.sourceLine(machine.cpu.regs.pc)).toBe(5);
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
    expect(machine.sourceLine(machine.cpu.regs.pc)).toBe(15);
    const afterAf = machine.banks();
    expect(afterAf.main.afActive).toBe(false);
    expect(afterAf.alternate.afActive).toBe(true);
    expect(afterAf.main.exxActive).toBe(true);
    expect(afterAf.alternate.exxActive).toBe(false);
    expect(afterAf.main.bc).toBe(0x1234);
    machine.step();
    expect(machine.sourceLine(machine.cpu.regs.pc)).toBe(16);
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

  it("follows PC through an ordinary instruction, EX AF, and EXX", () => {
    const machine = new Machine();
    expect(machine.assemble(["      LD A, 1", "      EX AF, AF'", "      EXX", "      NOP"].join("\n"))).toBe(true);
    expect(machine.sourceLine(machine.cpu.regs.pc)).toBe(1);
    machine.step();
    expect(machine.sourceLine(machine.cpu.regs.pc)).toBe(2);
    machine.step();
    expect(machine.sourceLine(machine.cpu.regs.pc)).toBe(3);
    machine.step();
    expect(machine.sourceLine(machine.cpu.regs.pc)).toBe(4);
    machine.reset();
    expect(machine.sourceLine(machine.cpu.regs.pc)).toBe(1);
  });

  it("has no source line when PC leaves the emitted bytes", () => {
    const machine = new Machine();
    expect(machine.assemble("      JP 200H\n      NOP\n")).toBe(true);
    expect(machine.sourceLine(0)).toBe(1);
    machine.step();
    expect(machine.cpu.regs.pc).toBe(0x200);
    expect(machine.sourceLine(machine.cpu.regs.pc)).toBeUndefined();
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
    expect(formatByte(0x41, "ascii")).toBe("A");
    expect(formatByte(0x00, "ascii")).toBe("\u00B7");
    expect(formatByte(0x7f, "ascii")).toBe("\u00B7");
    expect(formatByte(0x20, "ascii")).toBe(" ");
    expect(formatByte(0x7e, "ascii")).toBe("~");
    expect(formatWord(0x4142, "ascii")).toBe("AB");
    expect(formatWord(0x0100, "ascii")).toBe("\u00B7\u00B7");
    expect(bytesPerRow("hex")).toBe(16);
    expect(bytesPerRow("decimal")).toBe(8);
    expect(bytesPerRow("binary")).toBe(4);
    expect(bytesPerRow("ascii")).toBe(16);
    expect(formatNames()).toEqual(["hex", "decimal", "binary", "ascii"]);
    for (const format of ["hex", "decimal", "binary", "ascii"] as const) {
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
    saveFormat(storage, "ascii");
    expect(stored.get(FORMAT_STORAGE_KEY)).toBe("ascii");
    expect(loadFormat(storage)).toBe("ascii");
    expect(machine.snapshot()).toEqual(before);
  });
});

function runProgram(source: string, steps: number): Machine {
  const machine = new Machine();
  expect(machine.assemble(source)).toBe(true);
  for (let count = 0; count < steps; count += 1) {
    machine.step();
  }
  return machine;
}

describe("console", () => {
  it("OUT 00H appends", () => {
    const machine = runProgram(`
      LD A, 41H
      OUT (00H), A
    `, 2);
    expect([...machine.console.bytes]).toEqual([0x41]);
    expect(machine.console.text()).toBe("A");
  });

  it("IN 00H returns the queued byte and then removes it", () => {
    const machine = runProgram(`
      LD A, 20H
      IN A, (00H)
    `, 1);
    machine.console.enqueue(0x51);
    expect(machine.console.waiting).toBe(1);
    machine.step();
    expect(machine.cpu.regs.a).toBe(0x51);
    expect(machine.console.waiting).toBe(0);
  });

  it("IN 00H on an empty queue returns 00H", () => {
    const machine = runProgram(`
      LD A, 01H
      IN A, (00H)
    `, 2);
    expect(machine.cpu.regs.a).toBe(0x00);
    expect(machine.console.waiting).toBe(0);
  });

  it("IN 01H is 0FFH when a byte is waiting and 00H when not", () => {
    const machine = runProgram(`
      IN A, (01H)
      IN A, (01H)
      IN A, (00H)
      IN A, (01H)
    `, 1);
    expect(machine.cpu.regs.a).toBe(0x00);
    machine.console.enqueue(0x51);
    machine.step();
    expect(machine.cpu.regs.a).toBe(0xff);
    expect(machine.console.waiting).toBe(1);
    machine.step();
    expect(machine.cpu.regs.a).toBe(0x51);
    expect(machine.console.waiting).toBe(0);
    machine.step();
    expect(machine.cpu.regs.a).toBe(0x00);
  });

  it("OUT 01H does not print", () => {
    const machine = runProgram(`
      LD A, 41H
      OUT (01H), A
    `, 2);
    expect([...machine.console.bytes]).toEqual([]);
    expect(machine.console.text()).toBe("");
    expect(machine.cpu.regs.a).toBe(0x41);
  });

  it("IN and OUT on another port are unchanged", () => {
    const machine = runProgram(`
      LD A, 41H
      OUT (00H), A
      OUT (02H), A
      IN A, (02H)
      IN A, (00H)
    `, 0);
    machine.console.enqueue(0x52);
    machine.step();
    machine.step();
    expect([...machine.console.bytes]).toEqual([0x41]);
    machine.step();
    expect([...machine.console.bytes]).toEqual([0x41]);
    expect(machine.console.text()).toBe("A");
    expect(machine.console.waiting).toBe(1);
    machine.step();
    expect(machine.cpu.regs.a).toBe(0xff);
    expect(machine.console.waiting).toBe(1);
    expect([...machine.console.bytes]).toEqual([0x41]);
    machine.step();
    expect(machine.cpu.regs.a).toBe(0x52);
    expect(machine.console.waiting).toBe(0);
  });

  it("treats CR+LF as one newline", () => {
    const machine = runProgram(`
      LD A, 41H
      OUT (00H), A
      LD A, 0DH
      OUT (00H), A
      LD A, 0AH
      OUT (00H), A
      LD A, 42H
      OUT (00H), A
    `, 8);
    expect([...machine.console.bytes]).toEqual([0x41, 0x0d, 0x0a, 0x42]);
    expect(machine.console.text()).toBe("A\nB");
  });

  it("Reset empties the console and the queue", () => {
    const machine = runProgram(`
      LD A, 41H
      OUT (00H), A
    `, 2);
    machine.console.enqueue(0x51);
    machine.reset();
    expect(machine.console.text()).toBe("");
    expect([...machine.console.bytes]).toEqual([]);
    expect(machine.console.waiting).toBe(0);
    expect(machine.cpu.regs.a).toBe(0);
    expect(machine.steps).toBe(0);
  });

  it("draws tabs, backspace, and other bytes without changing machine state", () => {
    const machine = runProgram(`
      LD A, 41H
      OUT (00H), A
      LD A, 09H
      OUT (00H), A
      LD A, 42H
      OUT (00H), A
      LD A, 08H
      OUT (00H), A
      LD A, 07H
      OUT (00H), A
    `, 10);
    machine.console.enqueue(0x51);
    const before = machine.snapshot();
    const waiting = machine.console.waiting;
    expect(machine.console.text()).toBe(`A${" ".repeat(7)}${ASCII_MIDDLE_DOT}`);
    machine.console.write(0x4100, 0x0a);
    machine.console.write(0x0000, 0x08);
    machine.console.write(0, 0x43);
    expect(machine.console.text()).toBe(`A${" ".repeat(7)}${ASCII_MIDDLE_DOT}\nC`);
    expect(machine.snapshot()).toEqual(before);
    expect(machine.console.waiting).toBe(waiting);
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
