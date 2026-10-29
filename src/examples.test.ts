import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assemble } from "./assemble";
import { EXAMPLES } from "./examples";
import { Machine } from "./machine";

const examplesDir = join(dirname(fileURLToPath(import.meta.url)), "../examples");
const DOCUMENTED_FLAGS = 0xd7;

describe("example programs", () => {
  const files = readdirSync(examplesDir).filter((name) => name.endsWith(".asm")).sort();

  it("lists every asm file", () => {
    expect(EXAMPLES.map((example) => example.filename).sort()).toEqual(files);
  });

  for (const example of EXAMPLES) {
    it(`assembles ${example.filename}`, () => {
      const onDisk = readFileSync(join(examplesDir, example.filename), "utf8");
      expect(example.source).toBe(onDisk);
      const result = assemble(onDisk);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.origin).toBe(0x100);
      }
    });
  }

  it("console-echo writes and reads port 00H", () => {
    const source = readFileSync(join(examplesDir, "console-echo.asm"), "utf8");
    expect(source).toMatch(/OUT\s+\(\s*00H\s*\)\s*,\s*A/i);
    expect(source).toMatch(/IN\s+A\s*,\s*\(\s*00H\s*\)/i);
    expect(source).toContain("Type a character and press Queue before stepping the IN.");
    expect(source).not.toMatch(/\bJR\b/i);

    const result = assemble(source);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    let outs = 0;
    let reads = 0;
    for (let address = 0; address < result.image.length - 1; address += 1) {
      if (result.image[address] === 0xd3 && result.image[address + 1] === 0x00) {
        outs += 1;
      }
      if (result.image[address] === 0xdb && result.image[address + 1] === 0x00) {
        reads += 1;
      }
    }
    expect(outs).toBeGreaterThan(0);
    expect(reads).toBe(1);
  });

  it("echoes a prompt even when the queue is empty", () => {
    const machine = runUntilHalt("console-echo");
    expect(machine.halted).toBe(true);
    expect(machine.steps).toBeLessThan(15);
    expect(machine.console.text().startsWith(">")).toBe(true);
  });

  it("sets every documented flag while stepping flags.asm", () => {
    const machine = new Machine();
    expect(machine.assemble(sourceOf("flags"))).toBe(true);
    const seen = { s: false, z: false, h: false, pv: false, n: false, c: false };
    const cleared = { ...seen };
    const after = new Map<string, number>();
    while (!machine.halted && machine.steps < 20) {
      machine.step();
      const flags = machine.cpu.regs.f & DOCUMENTED_FLAGS;
      note(seen, flags, true);
      note(cleared, flags, false);
      after.set(machine.lastInstruction, flags);
    }
    expect(machine.halted).toBe(true);
    expect(seen).toEqual({ s: true, z: true, h: true, pv: true, n: true, c: true });
    expect(cleared).toEqual({ s: true, z: true, h: true, pv: true, n: true, c: true });
    expect(after.get("XOR A,A")).toBe(0x44);
    expect(after.get("ADD A,0X01")).toBe(0x94);
    expect(after.get("ADD A,0X80")).toBe(0x45);
    expect(after.get("CCF")).toBe(0x54);
    expect(after.get("OR 0X01")).toBe(0x00);
    expect(after.get("AND 0XF0")).toBe(0x54);
    expect(after.get("SUB A,0X01")).toBe(0x93);
  });

  it("pushes a word, calls, returns, and pops it back", () => {
    const machine = new Machine();
    expect(machine.assemble(sourceOf("stack"))).toBe(true);
    const source = sourceOf("stack");
    expect(source).toMatch(/grows downward/i);
    expect(source).toMatch(/BC → DE/);

    stepUntil(machine, "PUSH BC");
    expect(machine.cpu.regs.sp).toBe(0xfefe);
    expect(machine.memory[0xfefe]).toBe(0xef);
    expect(machine.memory[0xfeff]).toBe(0xbe);
    expect(machine.writes.map((write) => write.address).sort((a, b) => a - b)).toEqual([0xfefe, 0xfeff]);
    expect(machine.stackWords.get(0xfefe)).toEqual({ source: "BC" });

    stepUntil(machine, "CALL 0X010C");
    expect(machine.cpu.regs.sp).toBe(0xfefc);
    expect(machine.cpu.regs.pc).toBe(0x010c);
    expect(machine.memory[0xfefc]).toBe(0x0a);
    expect(machine.memory[0xfefd]).toBe(0x01);
    expect(machine.stackWords.get(0xfefc)).toEqual({ source: "return" });
    expect(machine.stackWords.get(0xfefe)).toEqual({ source: "BC" });

    stepUntil(machine, "RET");
    expect(machine.cpu.regs.sp).toBe(0xfefe);
    expect(machine.cpu.regs.pc).toBe(0x010a);
    expect(machine.stackWords.get(0xfefc)).toEqual({ source: "return", dest: "PC" });

    stepUntil(machine, "POP DE");
    expect(machine.cpu.regs.sp).toBe(0xff00);
    expect(machine.cpu.regs.de).toBe(0xbeef);
    expect(machine.memory[0xfefe]).toBe(0xef);
    expect(machine.memory[0xfeff]).toBe(0xbe);
    expect(machine.stackWords.get(0xfefe)).toEqual({ source: "BC", dest: "DE" });
  });

  it("stores 11H over a zero byte and then two neighbours", () => {
    const machine = runUntilHalt("memory");
    expect(machine.memory[0xc000]).toBe(0x11);
    expect(machine.memory[0xc001]).toBe(0x22);
    expect(machine.memory[0xc002]).toBe(0x33);
    expect(machine.memory[0xc003]).toBe(0x00);
  });

  it("swaps AF and the paired registers independently", () => {
    const machine = new Machine();
    expect(machine.assemble(sourceOf("exchange"))).toBe(true);
    stepUntil(machine, "EX AF,AF'");
    let banks = machine.banks();
    expect(banks.main.afActive).toBe(false);
    expect(banks.alternate.afActive).toBe(true);
    expect(banks.main.exxActive).toBe(true);
    expect(banks.main.af & 0xff00).toBe(0x1100);
    expect(banks.alternate.af & 0xff00).toBe(0);
    expect(banks.main.bc).toBe(0x1111);

    stepUntil(machine, "EXX");
    banks = machine.banks();
    expect(banks.main.afActive).toBe(false);
    expect(banks.alternate.afActive).toBe(true);
    expect(banks.main.exxActive).toBe(false);
    expect(banks.alternate.exxActive).toBe(true);
    expect(banks.main.bc).toBe(0x1111);
    expect(banks.main.de).toBe(0x2222);
    expect(banks.main.hl).toBe(0x3333);
    expect(banks.alternate.bc).toBe(0);
    expect((banks.alternate.af & 0xff00) >> 8).toBe(0xaa);
  });

  it("marks instruction lines in the table loop, not the labels", () => {
    const source = sourceOf("table");
    const lines = source.split("\n");
    const machine = new Machine();
    expect(machine.assemble(source)).toBe(true);
    const seen = new Set<number>();
    while (!machine.halted && machine.steps < 40) {
      const line = machine.sourceLine(machine.cpu.regs.pc);
      expect(line).toBeDefined();
      const text = lines[(line ?? 1) - 1]?.trim() ?? "";
      expect(text).not.toMatch(/^[A-Za-z_.][\w.]*:$/);
      expect(text.startsWith(";")).toBe(false);
      seen.add(line ?? 0);
      machine.step();
    }
    expect(machine.halted).toBe(true);
    const load = lines.findIndex((line) => /^\s*LD\s+A\s*,\s*\(\s*HL\s*\)/i.test(line)) + 1;
    const next = lines.findIndex((line) => line.trim() === "NEXT:") + 1;
    const table = lines.findIndex((line) => line.trim() === "TABLE:") + 1;
    expect(load).toBeGreaterThan(0);
    expect(seen.has(load)).toBe(true);
    expect(seen.has(next)).toBe(false);
    expect(seen.has(table)).toBe(false);
  });

  it("loads, increments, and adds the undocumented IX and IY halves", () => {
    const source = sourceOf("ix-halves");
    expect(source).toMatch(/LD\s+IXH\s*,\s*A/i);
    expect(source).toMatch(/LD\s+A\s*,\s*IXL/i);
    expect(source).toMatch(/INC\s+IXL/i);
    expect(source).toMatch(/DEC\s+IXH/i);
    expect(source).toMatch(/ADD\s+A\s*,\s*IXH/i);
    expect(source).toMatch(/LD\s+IYH\s*,\s*A/i);
    expect(source).toMatch(/LD\s+A\s*,\s*IYL/i);
    expect(source).toMatch(/INC\s+IYL/i);
    expect(source).toMatch(/DEC\s+IYH/i);
    expect(source).toMatch(/ADD\s+A\s*,\s*IYL/i);
    const code = source.split("\n").filter((line) => !line.trim().startsWith(";")).join("\n");
    expect(code).not.toMatch(/\(IX/i);
    expect(code).not.toMatch(/\(IY/i);

    const machine = runUntilHalt("ix-halves");
    expect(machine.halted).toBe(true);
    expect(machine.cpu.regs.ix & 0xffff).toBe(0x1113);
    expect(machine.cpu.regs.iy & 0xffff).toBe(0x3335);
    expect((machine.cpu.regs.af >> 8) & 0xff).toBe(0x36);
  });
});

function sourceOf(id: string): string {
  const example = EXAMPLES.find((item) => item.id === id);
  if (example === undefined) {
    throw new Error(`missing ${id}`);
  }
  return example.source;
}

function runUntilHalt(id: string): Machine {
  const machine = new Machine();
  expect(machine.assemble(sourceOf(id))).toBe(true);
  while (!machine.halted && machine.steps < 40) {
    machine.step();
  }
  return machine;
}

function stepUntil(machine: Machine, instruction: string): void {
  while (!machine.halted && machine.steps < 30 && machine.lastInstruction !== instruction) {
    machine.step();
  }
  expect(machine.lastInstruction).toBe(instruction);
}

function note(bucket: Record<string, boolean>, flags: number, set: boolean): void {
  const bits: Array<[keyof typeof bucket, number]> = [
    ["s", 0x80],
    ["z", 0x40],
    ["h", 0x10],
    ["pv", 0x04],
    ["n", 0x02],
    ["c", 0x01],
  ];
  for (const [key, mask] of bits) {
    if (((flags & mask) !== 0) === set) {
      bucket[key] = true;
    }
  }
}
