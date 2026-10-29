import { describe, expect, it } from "vitest";
import { exampleById } from "./examples";
import { Machine } from "./machine";
import {
  arithColumns,
  arithResult,
  captureMotionBase,
  clampSpeed,
  counterDigits,
  daaAdjust,
  loadSpeed,
  logicRows,
  nibbleRotate,
  planAfterStep,
  planMotion,
  saveSpeed,
  scaledMs,
  SHIFT_MS,
  shiftTracks,
  type ArithMotion,
  type BitMotion,
  type BranchMotion,
  type CounterMotion,
  type DaaMotion,
  type LogicMotion,
  type MotionFacts,
  type MotionPlan,
  type NibbleMotion,
  type ShiftKind,
  type ShiftMotion,
  type WordMotion,
} from "./motion";

function facts(partial: Partial<MotionFacts> & Pick<MotionFacts, "mnemonic">): MotionFacts {
  return {
    a: 0,
    af: 0,
    bc: 0,
    de: 0,
    hl: 0,
    sp: 0,
    pc: 0,
    ix: 0,
    iy: 0,
    i: 0,
    r: 0,
    spBefore: 0,
    pcBefore: 0,
    hlBefore: 0,
    bcBefore: 0,
    deBefore: 0,
    ixBefore: 0,
    iyBefore: 0,
    writes: [],
    consoleOut: undefined,
    consoleIn: false,
    ...partial,
  };
}

function run(source: string): MotionPlan[] {
  const machine = new Machine();
  expect(machine.assemble(source)).toBe(true);
  const plans: MotionPlan[] = [];
  while (!machine.halted && machine.steps < 30) {
    const base = captureMotionBase(machine);
    machine.step();
    plans.push(planAfterStep(base, machine));
  }
  return plans;
}

describe("planMotion", () => {
  it("carries a register into another register", () => {
    expect(planMotion(facts({ mnemonic: "LD A,B", a: 0x12, bc: 0x1200 }))).toEqual({
      type: "travel",
      moves: [{
        from: { type: "reg", name: "b" },
        to: { type: "reg", name: "a" },
        value: 0x12,
        width: 8,
        pop: false,
      }],
    });
  });

  it("carries an immediate from the source line", () => {
    const plan = planMotion(facts({ mnemonic: "LD A,0X11", a: 0x11 }));
    expect(plan).toEqual({
      type: "travel",
      moves: [{
        from: { type: "source" },
        to: { type: "reg", name: "a" },
        value: 0x11,
        width: 8,
        pop: false,
      }],
    });
  });

  it("splits a word immediate into the two bytes of BC", () => {
    const plan = planMotion(facts({ mnemonic: "LD BC,0X5678", bc: 0x5678 }));
    expect(plan).toEqual({
      type: "pair",
      dir: "split",
      value: 0x5678,
      high: 0x56,
      low: 0x78,
      highReg: "b",
      lowReg: "c",
      word: { type: "source" },
    });
    expect(planMotion(facts({ mnemonic: "LD IX,0X4000", ix: 0x4000 }))).toMatchObject({
      type: "pair",
      dir: "split",
      high: 0x40,
      low: 0x00,
      highReg: "ixh",
      lowReg: "ixl",
      word: { type: "source" },
    });
    expect(planMotion(facts({
      mnemonic: "LD HL,(0XC000)",
      hl: 0x1234,
    }))).toMatchObject({
      type: "pair",
      dir: "split",
      value: 0x1234,
      highReg: "h",
      lowReg: "l",
      word: { type: "mem", address: 0xc000 },
    });
    expect(planMotion(facts({ mnemonic: "LD SP,0XFF00", sp: 0xff00 }))).toMatchObject({
      type: "travel",
      moves: [{ to: { type: "reg", name: "sp" }, value: 0xff00, width: 16 }],
    });
  });

  it("moves an IX or IY half the way a byte of BC moves", () => {
    expect(planMotion(facts({ mnemonic: "LD IXH,A", a: 0x12, ix: 0x1200 }))).toEqual({
      type: "travel",
      moves: [{
        from: { type: "reg", name: "a" },
        to: { type: "reg", name: "ixh" },
        value: 0x12,
        width: 8,
        pop: false,
      }],
    });
    expect(planMotion(facts({ mnemonic: "LD A,IXL", a: 0x34, ix: 0x1234 }))).toMatchObject({
      type: "travel",
      moves: [{ from: { type: "reg", name: "ixl" }, to: { type: "reg", name: "a" }, value: 0x34, width: 8 }],
    });

    const seen = trace(exampleById("ix-halves")?.source ?? "");
    expect(seen.find((item) => item.mnemonic === "LD IXH,A")?.plan).toMatchObject({
      type: "travel",
      moves: [{ from: { type: "reg", name: "a" }, to: { type: "reg", name: "ixh" }, value: 0x12, width: 8 }],
    });
    expect(seen.find((item) => item.mnemonic === "LD A,IXL")?.plan).toMatchObject({
      type: "travel",
      moves: [{ from: { type: "reg", name: "ixl" }, to: { type: "reg", name: "a" }, width: 8 }],
    });
    expect(seen.find((item) => item.mnemonic === "LD IYH,A")?.plan).toMatchObject({
      type: "travel",
      moves: [{ to: { type: "reg", name: "iyh" }, width: 8 }],
    });
    expect(counterNamed(seen, "INC IXL")).toMatchObject({
      dir: "inc", width: 8, before: 0x12, after: 0x13, anchor: { type: "reg", name: "ixl" },
    });
    expect(counterNamed(seen, "DEC IXH")).toMatchObject({
      dir: "dec", width: 8, before: 0x12, after: 0x11, anchor: { type: "reg", name: "ixh" },
    });
    expect(counterNamed(seen, "INC IYL")).toMatchObject({
      dir: "inc", anchor: { type: "reg", name: "iyl" },
    });
    expect(counterNamed(seen, "DEC IYH")).toMatchObject({
      dir: "dec", anchor: { type: "reg", name: "iyh" },
    });
    expect(aluNamed(seen, "ADD A,IXH")).toMatchObject({
      op: "add", left: 0x01, right: 0x11, result: 0x12, other: { type: "reg", name: "ixh" }, dest: { type: "reg", name: "a" },
    });
    expect(aluNamed(seen, "ADD A,IYL")).toMatchObject({
      op: "add", other: { type: "reg", name: "iyl" }, dest: { type: "reg", name: "a" },
    });
  });

  it("carries a store to the memory cell and a load back", () => {
    expect(planMotion(facts({
      mnemonic: "LD (HL),A",
      a: 0x3c,
      hlBefore: 0xc000,
    }))).toMatchObject({
      moves: [{ from: { type: "reg", name: "a" }, to: { type: "mem", address: 0xc000 }, value: 0x3c, width: 8 }],
    });
    expect(planMotion(facts({
      mnemonic: "LD A,(0XC000)",
      a: 0x3c,
    }))).toMatchObject({
      moves: [{ from: { type: "mem", address: 0xc000 }, to: { type: "reg", name: "a" }, value: 0x3c }],
    });
    expect(planMotion(facts({
      mnemonic: "LD (HL),0X22",
      hlBefore: 0xc001,
    }))).toMatchObject({
      moves: [{ from: { type: "source" }, to: { type: "mem", address: 0xc001 }, value: 0x22 }],
    });
  });

  it("signs an indexed displacement", () => {
    expect(planMotion(facts({
      mnemonic: "LD (IX+0X05),A",
      a: 0x99,
      ixBefore: 0x4000,
    }))).toMatchObject({
      moves: [{ to: { type: "mem", address: 0x4005 }, value: 0x99 }],
    });
    expect(planMotion(facts({
      mnemonic: "LD A,(IX+0XFF)",
      a: 0x77,
      ixBefore: 0x4000,
    }))).toMatchObject({
      moves: [{ from: { type: "mem", address: 0x3fff }, to: { type: "reg", name: "a" }, value: 0x77 }],
    });
  });

  it("swaps AF and EXX separately and crosses DE with HL", () => {
    expect(planMotion(facts({ mnemonic: "EX AF,AF'" }))).toEqual({ type: "swap", group: "af" });
    expect(planMotion(facts({ mnemonic: "EXX" }))).toEqual({ type: "swap", group: "exx" });
    expect(planMotion(facts({
      mnemonic: "EX DE,HL",
      deBefore: 0x1111,
      hlBefore: 0x2222,
    }))).toEqual({
      type: "travel",
      moves: [
        { from: { type: "reg", name: "de" }, to: { type: "reg", name: "hl" }, value: 0x1111, width: 16, pop: false },
        { from: { type: "reg", name: "hl" }, to: { type: "reg", name: "de" }, value: 0x2222, width: 16, pop: false },
      ],
    });
  });

  it("pops a console write and carries a console read into A", () => {
    expect(planMotion(facts({ mnemonic: "OUT (0X00),A", a: 0x48, consoleOut: 0x48 }))).toEqual({
      type: "travel",
      moves: [{
        from: { type: "reg", name: "a" },
        to: { type: "console" },
        value: 0x48,
        width: 8,
        pop: true,
      }],
    });
    expect(planMotion(facts({ mnemonic: "IN A,(0X00)", a: 0x51, consoleIn: true }))).toMatchObject({
      moves: [{ from: { type: "console" }, to: { type: "reg", name: "a" }, value: 0x51, pop: false }],
    });
    expect(planMotion(facts({ mnemonic: "IN A,(0X01)", a: 0xff, consoleIn: false }))).toEqual({ type: "none" });
  });

  it("leaves arithmetic alone", () => {
    expect(planMotion(facts({ mnemonic: "ADD A,B", a: 0x05 }))).toEqual({ type: "none" });
    expect(planMotion(facts({ mnemonic: "INC HL" }))).toEqual({ type: "none" });
    expect(planMotion(facts({ mnemonic: "HALT" }))).toEqual({ type: "none" });
  });
});

describe("examples", () => {
  it("plans the exchange program", () => {
    const machine = new Machine();
    expect(machine.assemble(exampleById("exchange")?.source ?? "")).toBe(true);
    const seen: { mnemonic: string; plan: MotionPlan }[] = [];
    while (!machine.halted && machine.steps < 20) {
      const base = captureMotionBase(machine);
      machine.step();
      seen.push({ mnemonic: machine.lastInstruction, plan: planAfterStep(base, machine) });
    }
    expect(seen.map((step) => step.mnemonic)).toEqual([
      "LD A,0X11",
      "LD BC,0X1111",
      "LD DE,0X2222",
      "LD HL,0X3333",
      "EX AF,AF'",
      "LD A,0XAA",
      "EXX",
      "LD BC,0XBBBB",
      "LD DE,0XCCCC",
      "LD HL,0XDDDD",
      "EX AF,AF'",
      "EXX",
      "HALT",
    ]);
    expect(seen[0].plan).toMatchObject({
      type: "travel",
      moves: [{ from: { type: "source" }, to: { type: "reg", name: "a" }, value: 0x11 }],
    });
    expect(seen[4].plan).toEqual({ type: "swap", group: "af" });
    expect(seen[6].plan).toEqual({ type: "swap", group: "exx" });
    expect(seen[5].plan).toMatchObject({
      moves: [{ to: { type: "reg", name: "a" }, value: 0xaa }],
    });
    expect(seen[12].plan).toEqual({ type: "none" });
  });

  it("plans the sample store and the console character", () => {
    const sample = run(exampleById("sample")?.source ?? "");
    const store = sample.find((plan) => plan.type === "travel" && plan.moves.some((move) => move.to.type === "mem"));
    expect(store).toMatchObject({
      moves: [{ from: { type: "reg", name: "a" }, to: { type: "mem", address: 0xc000 }, value: 0x3c }],
    });

    const machine = new Machine();
    expect(machine.assemble(exampleById("console")?.source ?? "")).toBe(true);
    machine.step();
    machine.console.enqueueText("Q");
    const beforeOut = captureMotionBase(machine);
    machine.step();
    expect(machine.lastInstruction).toBe("OUT (0X00),A");
    expect(planAfterStep(beforeOut, machine)).toMatchObject({
      moves: [{ from: { type: "reg", name: "a" }, to: { type: "console" }, value: 0x48, pop: true }],
    });
    while (!machine.halted && machine.lastInstruction !== "IN A,(0X00)" && machine.steps < 12) {
      machine.step();
    }
    expect(machine.lastInstruction).toBe("IN A,(0X00)");
    expect(machine.cpu.regs.a).toBe(0x51);
  });

  it("flies PUSH and CALL onto the stack and POP and RET back off", () => {
    const machine = new Machine();
    expect(machine.assemble(exampleById("stack")?.source ?? "")).toBe(true);
    const seen: { mnemonic: string; plan: MotionPlan; sp: number }[] = [];
    while (!machine.halted && machine.steps < 12) {
      const base = captureMotionBase(machine);
      machine.step();
      seen.push({ mnemonic: machine.lastInstruction, plan: planAfterStep(base, machine), sp: machine.cpu.regs.sp });
    }
    expect(seen.map((step) => step.mnemonic)).toEqual([
      "LD SP,0XFF00",
      "LD BC,0XBEEF",
      "PUSH BC",
      "CALL 0X010C",
      "RET",
      "POP DE",
      "HALT",
    ]);
    expect(seen[2].sp).toBe(0xfefe);
    expect(seen[2].plan).toMatchObject({
      type: "pair",
      dir: "join",
      value: 0xbeef,
      high: 0xbe,
      low: 0xef,
      highReg: "b",
      lowReg: "c",
      word: { type: "mem", address: 0xfefe },
      label: "BC",
    });
    expect(seen[3].sp).toBe(0xfefc);
    expect(seen[3].plan).toMatchObject({
      moves: [{ from: { type: "reg", name: "pc" }, to: { type: "mem", address: 0xfefc }, value: 0x010a, width: 16, label: "return" }],
    });
    expect(seen[4].sp).toBe(0xfefe);
    expect(seen[4].plan).toMatchObject({
      moves: [{ from: { type: "mem", address: 0xfefc }, to: { type: "reg", name: "pc" }, value: 0x010a, label: "return → PC" }],
    });
    expect(seen[5].sp).toBe(0xff00);
    expect(seen[5].plan).toMatchObject({
      type: "pair",
      dir: "split",
      value: 0xbeef,
      high: 0xbe,
      low: 0xef,
      highReg: "d",
      lowReg: "e",
      word: { type: "mem", address: 0xfefe },
      label: "BC → DE",
    });
  });
});

function trace(source: string): { mnemonic: string; plan: MotionPlan; af: number }[] {
  const machine = new Machine();
  expect(machine.assemble(source), JSON.stringify(machine.errors)).toBe(true);
  const seen: { mnemonic: string; plan: MotionPlan; af: number }[] = [];
  while (!machine.halted && machine.steps < 40) {
    const base = captureMotionBase(machine);
    machine.step();
    seen.push({
      mnemonic: machine.lastInstruction,
      plan: planAfterStep(base, machine),
      af: machine.cpu.regs.af & 0xffff,
    });
  }
  return seen;
}

function shiftNamed(seen: { mnemonic: string; plan: MotionPlan }[], mnemonic: string): ShiftMotion {
  const step = seen.find((item) => item.mnemonic === mnemonic);
  expect(step?.plan.type).toBe("shift");
  return step?.plan as ShiftMotion;
}

describe("shift and rotate motion", () => {
  it("rotates 81H through Carry and around the byte", () => {
    const rla = shiftNamed(trace(`
      ORG 0100H
      LD A, 81H
      RLA
      HALT
    `), "RLA");
    expect(rla).toMatchObject({
      anchor: { type: "reg", name: "a" },
      before: 0x81,
      after: 0x02,
      carryBefore: false,
      carryAfter: true,
      kind: "rl",
      flagsFromResult: false,
    });

    const rlc = shiftNamed(trace(`
      ORG 0100H
      LD A, 81H
      RLC A
      HALT
    `), "RLC A");
    expect(rlc).toMatchObject({
      anchor: { type: "reg", name: "a" },
      before: 0x81,
      after: 0x03,
      carryBefore: false,
      carryAfter: true,
      kind: "rlc",
      flagsFromResult: true,
      parity: true,
    });

    const rra = trace(`
      ORG 0100H
      SCF
      LD A, 01H
      RRA
      HALT
    `);
    const step = shiftNamed(rra, "RRA");
    expect(step).toMatchObject({
      anchor: { type: "reg", name: "a" },
      before: 0x01,
      after: 0x80,
      carryBefore: true,
      kind: "rr",
      flagsFromResult: false,
    });
    // The low bit of 01H is 1, so that bit replaces Carry and Carry stays set.
    expect(step.carryAfter).toBe(true);
    expect(rra.find((item) => item.mnemonic === "RRA")?.af).toBe(0x8001);
  });

  it("leaves S, Z, and P/V alone on RLA and sets them from a CB shift", () => {
    const seen = trace(`
      ORG 0100H
      LD A, 80H
      OR A
      RLA
      RL A
      HALT
    `);
    const rla = shiftNamed(seen, "RLA");
    expect(rla.flagsFromResult).toBe(false);
    expect(rla.after).toBe(0x00);
    expect(rla.carryAfter).toBe(true);
    expect(rla.sign).toBe(true);
    expect(rla.zero).toBe(false);
    const rl = shiftNamed(seen, "RL A");
    expect(rl.flagsFromResult).toBe(true);
    expect(rl.before).toBe(0x00);
    expect(rl.after).toBe(0x01);
    expect(rl.carryBefore).toBe(true);
    expect(rl.carryAfter).toBe(false);
    expect(rl.zero).toBe(false);
    expect(rl.sign).toBe(false);
  });

  it("pops a memory byte for (HL) and for indexed shifts, including SLL", () => {
    const machine = new Machine();
    const source = `
      ORG 0100H
      LD HL, 0C000H
      LD (HL), 81H
      SLA (HL)
      LD IX, 4000H
      LD (IX+5), 81H
      RL (IX+5)
      LD IY, 5000H
      LD (IY+0FFH), 01H
      RRC (IY+0FFH)
      LD A, 80H
      SLL A
      HALT
    `;
    expect(machine.assemble(source), JSON.stringify(machine.errors)).toBe(true);
    const seen: { mnemonic: string; plan: MotionPlan }[] = [];
    while (!machine.halted && machine.steps < 40) {
      const base = captureMotionBase(machine);
      machine.step();
      seen.push({ mnemonic: machine.lastInstruction, plan: planAfterStep(base, machine) });
    }
    expect(machine.memory[0xc000]).toBe(0x02);
    expect(machine.memory[0x4005]).toBe(0x03);
    expect(machine.memory[0x4fff]).toBe(0x80);
    expect(machine.cpu.regs.a).toBe(0x01);
    const sla = shiftNamed(seen, "SLA (HL)");
    expect(sla.anchor).toEqual({ type: "mem", address: 0xc000 });
    expect(sla).toMatchObject({ before: 0x81, after: 0x02, kind: "sla", carryAfter: true, flagsFromResult: true });
    const indexed = seen.filter((item) => item.plan.type === "shift" && item.plan.anchor.type === "mem");
    expect(indexed.map((item) => item.plan)).toEqual([
      expect.objectContaining({ anchor: { type: "mem", address: 0xc000 }, kind: "sla" }),
      expect.objectContaining({ anchor: { type: "mem", address: 0x4005 }, kind: "rl", before: 0x81, after: 0x03 }),
      expect.objectContaining({ anchor: { type: "mem", address: 0x4fff }, kind: "rrc", before: 0x01, after: 0x80 }),
    ]);
    expect(shiftNamed(seen, "SLL A")).toMatchObject({
      anchor: { type: "reg", name: "a" },
      before: 0x80,
      after: 0x01,
      kind: "sll",
      carryAfter: true,
      flagsFromResult: true,
    });
  });

  it("sends the leaving bit to Carry and wraps only on a rotate", () => {
    const landed = (kind: ShiftKind, before: number, carry: boolean) => {
      const tracks = shiftTracks(kind, before, carry);
      const bits = Array.from({ length: 8 }, () => 0);
      for (const track of tracks) {
        if (track.to === "bit" && track.toSlot !== undefined) {
          bits[track.toSlot] = track.value;
        }
      }
      const value = bits.reduce((packed, bit) => (packed << 1) | bit, 0);
      const leaving = tracks.find((track) => track.to === "carry");
      return { value, carry: leaving?.value === 1, wrapped: tracks.some((track) => track.from === "bit" && track.to === "bit" && track.fromSlot !== track.toSlot && (track.fromSlot === 0 || track.fromSlot === 7) && (track.toSlot === 0 || track.toSlot === 7)) };
    };
    expect(landed("rl", 0x81, false)).toEqual({ value: 0x02, carry: true, wrapped: false });
    expect(landed("rlc", 0x81, false)).toEqual({ value: 0x03, carry: true, wrapped: true });
    expect(landed("rr", 0x01, true)).toEqual({ value: 0x80, carry: true, wrapped: false });
    expect(landed("rrc", 0x01, false)).toEqual({ value: 0x80, carry: true, wrapped: true });
    expect(landed("sll", 0x80, false)).toEqual({ value: 0x01, carry: true, wrapped: false });
    expect(landed("sra", 0x81, false)).toEqual({ value: 0xc0, carry: true, wrapped: false });
    expect(landed("srl", 0x81, false)).toEqual({ value: 0x40, carry: true, wrapped: false });
  });
});

function bitNamed(seen: { mnemonic: string; plan: MotionPlan; af: number }[], mnemonic: string): BitMotion & { af: number } {
  const step = seen.find((item) => item.mnemonic === mnemonic);
  expect(step?.plan.type).toBe("bit");
  return { ...(step?.plan as BitMotion), af: step?.af ?? 0 };
}

describe("bit set, reset, and test", () => {
  it("sets and resets a bit without changing flags, and BIT takes Z from the opposite bit", () => {
    const seen = trace(`
      ORG 0100H
      LD A, 00H
      SCF
      SET 0, A
      RES 0, A
      BIT 0, A
      LD A, 01H
      BIT 0, A
      HALT
    `);
    const set = bitNamed(seen, "SET 0,A");
    expect(set).toMatchObject({
      op: "set",
      bit: 0,
      before: 0x00,
      after: 0x01,
      anchor: { type: "reg", name: "a" },
      zeroBefore: false,
      zeroAfter: false,
    });
    expect(set.af & 0xff).toBe(0x01);
    const res = bitNamed(seen, "RES 0,A");
    expect(res).toMatchObject({ op: "res", bit: 0, before: 0x01, after: 0x00 });
    expect(res.af & 0xff).toBe(0x01);
    const bitClear = bitNamed(seen, "BIT 0,A");
    expect(bitClear).toMatchObject({ op: "bit", bit: 0, before: 0x00, after: 0x00, zeroAfter: true });
    const bitSet = seen.filter((item) => item.mnemonic === "BIT 0,A")[1];
    expect(bitSet?.plan).toMatchObject({ op: "bit", bit: 0, before: 0x01, after: 0x01, zeroAfter: false });
    expect((bitSet?.af ?? 0) & 0xff & 0x40).toBe(0);
    expect((bitSet?.af ?? 0) >> 8).toBe(0x01);
  });

  it("pops the memory byte for BIT, SET, and RES, including an index", () => {
    const machine = new Machine();
    const source = `
      ORG 0100H
      LD HL, 0C000H
      LD (HL), 01H
      BIT 0, (HL)
      LD IX, 4000H
      LD (IX+1), 00H
      SET 0, (IX+1)
      LD IY, 5000H
      LD (IY+0FFH), 01H
      RES 0, (IY+0FFH)
      HALT
    `;
    expect(machine.assemble(source), JSON.stringify(machine.errors)).toBe(true);
    const seen: { mnemonic: string; plan: MotionPlan }[] = [];
    while (!machine.halted && machine.steps < 20) {
      const base = captureMotionBase(machine);
      machine.step();
      seen.push({ mnemonic: machine.lastInstruction, plan: planAfterStep(base, machine) });
    }
    expect(machine.memory[0xc000]).toBe(0x01);
    expect(machine.memory[0x4001]).toBe(0x01);
    expect(machine.memory[0x4fff]).toBe(0x00);
    const bits = seen.filter((item) => item.plan.type === "bit").map((item) => item.plan);
    expect(bits).toEqual([
      expect.objectContaining({ op: "bit", anchor: { type: "mem", address: 0xc000 }, before: 0x01, after: 0x01, zeroAfter: false }),
      expect.objectContaining({ op: "set", anchor: { type: "mem", address: 0x4001 }, before: 0x00, after: 0x01, bit: 0 }),
      expect.objectContaining({ op: "res", anchor: { type: "mem", address: 0x4fff }, before: 0x01, after: 0x00, bit: 0 }),
    ]);
  });
});

function logicNamed(seen: { mnemonic: string; plan: MotionPlan }[], mnemonic: string): LogicMotion {
  const step = seen.find((item) => item.mnemonic === mnemonic);
  expect(step?.plan.type).toBe("logic");
  return step?.plan as LogicMotion;
}

describe("animation speed", () => {
  it("keeps 1× as the built-in pace and stretches or shortens every duration", () => {
    expect(clampSpeed(Number.NaN)).toBe(1);
    expect(clampSpeed(0)).toBe(0.1);
    expect(clampSpeed(9)).toBe(2);
    expect(scaledMs(SHIFT_MS, 1)).toBe(SHIFT_MS);
    expect(scaledMs(520, 0.1)).toBe(5200);
    expect(scaledMs(900, 2)).toBe(450);
    expect(scaledMs(1100, 0.1)).toBe(11000);
    expect(scaledMs(1200, 2)).toBe(600);
    expect(scaledMs(520, 0.25)).toBe(2080);
    const storage = new Map<string, string>();
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    expect(loadSpeed(memory)).toBe(1);
    saveSpeed(memory, 0.25);
    expect(loadSpeed(memory)).toBe(0.25);
    saveSpeed(memory, 0.1);
    expect(loadSpeed(memory)).toBe(0.1);
    saveSpeed(memory, 4);
    expect(loadSpeed(memory)).toBe(2);
  });
});

describe("logical operations", () => {
  it("combines each bit of AND, OR, and XOR", () => {
    expect(logicRows("and", 0xf0, 0x0f).result.join("")).toBe("00000000");
    expect(logicRows("or", 0xf0, 0x0f).result.join("")).toBe("11111111");
    expect(logicRows("xor", 0xff, 0x0f).result.join("")).toBe("11110000");
    const seen = trace(`
      ORG 0100H
      LD L, 0FH
      LD A, 0F0H
      AND L
      LD A, 0F0H
      OR L
      LD A, 0FFH
      XOR L
      LD A, 0F0H
      AND 0FH
      LD HL, 0C000H
      LD (HL), 0FH
      LD A, 0F0H
      AND (HL)
      LD IX, 4000H
      LD (IX+1), 0F0H
      LD A, 0FFH
      XOR (IX+1)
      LD IY, 5000H
      LD (IY+0FFH), 0FH
      LD A, 0F0H
      OR (IY+0FFH)
      ADD A, L
      CP L
      HALT
    `);
    expect(logicNamed(seen, "AND A,L")).toMatchObject({
      op: "and", left: 0xf0, right: 0x0f, result: 0x00, other: { type: "reg", name: "l" },
    });
    expect(logicNamed(seen, "OR A,L")).toMatchObject({ op: "or", left: 0xf0, right: 0x0f, result: 0xff });
    expect(logicNamed(seen, "XOR A,L")).toMatchObject({ op: "xor", left: 0xff, right: 0x0f, result: 0xf0 });
    expect(logicNamed(seen, "AND 0X0F")).toMatchObject({
      op: "and", right: 0x0f, result: 0x00, other: { type: "source" },
    });
    expect(logicNamed(seen, "AND A,(HL)")).toMatchObject({
      op: "and", other: { type: "mem", address: 0xc000 }, right: 0x0f, result: 0x00,
    });
    expect(logicNamed(seen, "XOR A,(IX+0X01)")).toMatchObject({
      op: "xor", other: { type: "mem", address: 0x4001 }, left: 0xff, right: 0xf0, result: 0x0f,
    });
    expect(logicNamed(seen, "OR A,(IY+0XFF)")).toMatchObject({
      op: "or", other: { type: "mem", address: 0x4fff }, left: 0xf0, right: 0x0f, result: 0xff,
    });
    expect(seen.find((item) => item.mnemonic === "ADD A,L")?.plan.type).toBe("alu");
    expect(seen.find((item) => item.mnemonic === "CP L")?.plan.type).toBe("alu");
  });
});

function counterNamed(seen: { mnemonic: string; plan: MotionPlan }[], mnemonic: string): CounterMotion {
  const matches = seen.filter((item) => item.mnemonic === mnemonic && item.plan.type === "counter");
  expect(matches.length).toBeGreaterThan(0);
  return matches[0]?.plan as CounterMotion;
}

describe("increment and decrement wheels", () => {
  it("rolls hex, decimal, binary, and ASCII digits, including a carry into the next wheel", () => {
    expect(counterDigits(0x0f, 0x10, "hex", 8, "inc")).toMatchObject({
      from: "0F",
      to: "10",
      wheels: [
        { from: "0", to: "1", turns: false },
        { from: "F", to: "0", turns: true },
      ],
    });
    expect(counterDigits(0x00ff, 0x0100, "hex", 16, "inc")).toMatchObject({ from: "00FF", to: "0100" });
    expect(counterDigits(0x10, 0x0f, "hex", 8, "dec").wheels[1]).toMatchObject({ from: "0", to: "F", turns: true });
    expect(counterDigits(9, 10, "decimal", 8, "inc")).toMatchObject({
      from: "009",
      to: "010",
      wheels: [
        { from: "0", to: "0", turns: false },
        { from: "0", to: "1", turns: false },
        { from: "9", to: "0", turns: true },
      ],
    });
    expect(counterDigits(1, 2, "binary", 8, "inc").from).toBe("00000001");
    expect(counterDigits(1, 2, "binary", 8, "inc").to).toBe("00000010");
    expect(counterDigits(0x41, 0x42, "ascii", 8, "inc")).toMatchObject({ from: "41", to: "42" });
    expect(counterDigits(0x00, 0xff, "hex", 8, "dec")).toMatchObject({ from: "00", to: "FF" });
  });

  it("plans 8-bit and 16-bit INC and DEC, including memory and index operands", () => {
    const seen = trace(`
      ORG 0100H
      LD A, 0FH
      INC A
      DEC A
      LD HL, 00FFH
      INC HL
      DEC HL
      LD BC, 0001H
      DEC BC
      LD SP, 0000H
      INC SP
      LD IX, 00FFH
      INC IX
      LD IY, 0100H
      DEC IY
      LD HL, 0C000H
      LD (HL), 0FH
      INC (HL)
      LD IX, 4000H
      LD (IX+1), 0FH
      DEC (IX+1)
      LD IY, 5000H
      LD (IY+0FFH), 10H
      INC (IY+0FFH)
      HALT
    `);
    expect(counterNamed(seen, "INC A")).toMatchObject({
      dir: "inc", width: 8, before: 0x0f, after: 0x10, anchor: { type: "reg", name: "a" },
    });
    expect(counterNamed(seen, "DEC A")).toMatchObject({ dir: "dec", before: 0x10, after: 0x0f });
    expect(counterNamed(seen, "INC HL")).toMatchObject({
      dir: "inc", width: 16, before: 0x00ff, after: 0x0100, anchor: { type: "reg", name: "hl" },
    });
    expect(counterNamed(seen, "DEC BC")).toMatchObject({
      dir: "dec", width: 16, before: 0x0001, after: 0x0000, anchor: { type: "reg", name: "bc" },
    });
    expect(counterNamed(seen, "INC SP")).toMatchObject({
      dir: "inc", width: 16, before: 0, after: 1, anchor: { type: "reg", name: "sp" },
    });
    expect(counterNamed(seen, "INC IX")).toMatchObject({
      dir: "inc", width: 16, before: 0x00ff, after: 0x0100, anchor: { type: "reg", name: "ix" },
    });
    expect(counterNamed(seen, "DEC IY")).toMatchObject({
      dir: "dec", width: 16, before: 0x0100, after: 0x00ff, anchor: { type: "reg", name: "iy" },
    });
    expect(counterNamed(seen, "INC (HL)")).toMatchObject({
      dir: "inc", width: 8, before: 0x0f, after: 0x10, anchor: { type: "mem", address: 0xc000 },
    });
    expect(counterNamed(seen, "DEC (IX+0X01)")).toMatchObject({
      dir: "dec", before: 0x0f, after: 0x0e, anchor: { type: "mem", address: 0x4001 },
    });
    expect(counterNamed(seen, "INC (IY+0XFF)")).toMatchObject({
      dir: "inc", before: 0x10, after: 0x11, anchor: { type: "mem", address: 0x4fff },
    });
  });
});

describe("arithmetic pictures", () => {
  it("steps a carry or borrow into the next decimal digit and leaves A alone for CP", () => {
    const added = arithColumns("add", 99, 1, false);
    expect(added[0]).toMatchObject({ place: 0, left: 9, right: 1, digit: 0, carryIn: 0, carryOut: 1 });
    expect(added[1]).toMatchObject({ place: 1, left: 9, right: 0, digit: 0, carryIn: 1, carryOut: 1 });
    expect(added[2]).toMatchObject({ place: 2, left: 0, right: 0, digit: 1, carryIn: 1, carryOut: 0 });
    expect(arithResult(added)).toBe(100);
    expect(arithColumns("adc", 15, 0, true)[0]).toMatchObject({ carryIn: 1, digit: 6, carryOut: 0 });
    expect(arithResult(arithColumns("sub", 16, 1, false))).toBe(15);
    expect(arithColumns("sub", 100, 1, false)[0]).toMatchObject({ digit: 9, carryOut: 1 });
    expect(arithColumns("sub", 100, 1, false)[1]).toMatchObject({ carryIn: 1, digit: 9, carryOut: 1 });
    expect(arithColumns("sbc", 0, 0, true).map((column) => column.digit).join("")).toBe("999");
    expect(arithResult(arithColumns("sbc", 0, 0, true))).toBe(999);
    expect(arithResult(arithColumns("cp", 16, 16, false))).toBe(0);
    const wide = arithColumns("add", 200, 200, false);
    expect(wide.map((column) => column.digit).join("")).toBe("004");
    expect(wide[2]?.carryOut).toBe(0);
    expect(arithResult(wide)).toBe(400);

    const seen = trace(exampleById("arithmetic")?.source ?? "");
    const add = aluNamed(seen, "ADD A,0X01");
    expect(add).toMatchObject({
      op: "add", left: 0x0f, right: 0x01, result: 0x10, stored: true, other: { type: "source" },
    });
    expect(add.columns.map((column) => column.digit).join("")).toBe("610");
    expect(add.columns[0]).toMatchObject({ place: 0, left: 5, right: 1, carryOut: 0 });
    expect(aluNamed(seen, "ADC A,L")).toMatchObject({
      op: "adc", left: 0x10, right: 0x01, result: 0x11, other: { type: "reg", name: "l" },
    });
    expect(aluNamed(seen, "ADC A,L").columns[0]?.carryIn).toBe(0);
    expect(aluNamed(seen, "SUB A,(HL)")).toMatchObject({
      op: "sub", right: 0x01, result: 0x10, other: { type: "mem", address: 0xc001 },
    });
    expect(aluNamed(seen, "SBC A,(IX+0X01)")).toMatchObject({
      op: "sbc", right: 0x00, other: { type: "mem", address: 0x4001 }, stored: true,
    });
    const compare = aluNamed(seen, "CP (IY+0XFF)");
    expect(compare).toMatchObject({
      op: "cp", left: 0x10, right: 0x10, result: 0x00, stored: false, other: { type: "mem", address: 0x4fff },
    });
    expect(compare.flags.z).toBe(true);
    const compared = seen.find((item) => item.mnemonic === "CP (IY+0XFF)");
    expect((compared?.af ?? 0) >> 8).toBe(0x10);

    const wrapped = trace(`
      ORG 0100H
      LD A, 0C8H
      ADD A, 0C8H
      HALT
    `);
    const overflow = aluNamed(wrapped, "ADD A,0XC8");
    expect(overflow.result).toBe(0x90);
    expect(arithResult(overflow.columns)).toBe(400);

    const borrowed = trace(`
      ORG 0100H
      LD A, 00H
      SCF
      SBC A, 00H
      HALT
    `);
    const sbc = aluNamed(borrowed, "SBC A,0X00");
    expect(sbc.result).toBe(0xff);
    expect(sbc.columns[0]).toMatchObject({ carryIn: 1, digit: 9, carryOut: 1 });
    expect(arithResult(sbc.columns)).toBe(999);
  });

  it("steps a carry or borrow into the next decimal digit of a word", () => {
    const added = arithColumns("add", 99, 1, false, 5);
    expect(added[0]).toMatchObject({ place: 0, digit: 0, carryOut: 1 });
    expect(added[1]).toMatchObject({ place: 1, carryIn: 1, digit: 0, carryOut: 1 });
    expect(added[2]).toMatchObject({ place: 2, carryIn: 1, digit: 1, carryOut: 0 });
    expect(arithResult(added)).toBe(100);
    const sum = arithColumns("add", 0x00ff, 0x0001, false, 5);
    expect(sum.map((column) => column.digit).join("")).toBe("65200");
    expect(sum.every((column) => column.carryOut === 0)).toBe(true);
    const difference = arithColumns("sbc", 0x0100, 0x0001, false, 5);
    expect(difference[0]).toMatchObject({ digit: 5, carryOut: 0 });
    expect(arithResult(difference)).toBe(255);

    const seen = trace(exampleById("arithmetic")?.source ?? "");
    expect(wordNamed(seen, "ADD HL,BC")).toMatchObject({
      op: "add", dest: "hl", other: "bc", left: 0x00ff, right: 0x0001, result: 0x0100,
    });
    expect(wordNamed(seen, "ADD HL,BC").columns[0]?.carryOut).toBe(0);
    expect(wordNamed(seen, "ADD IX,BC")).toMatchObject({
      op: "add", dest: "ix", other: "bc", left: 0x00ff, result: 0x0100,
    });
    expect(wordNamed(seen, "ADD IY,BC")).toMatchObject({
      op: "add", dest: "iy", other: "bc", result: 0x0100,
    });
    expect(wordNamed(seen, "ADC HL,BC")).toMatchObject({
      op: "adc", dest: "hl", left: 0x0100, right: 0x0001, result: 0x0102,
    });
    expect(wordNamed(seen, "ADC HL,BC").columns[0]?.carryIn).toBe(1);
    expect(wordNamed(seen, "SBC HL,BC")).toMatchObject({
      op: "sbc", left: 0x0100, right: 0x0001, result: 0x00ff,
    });
    expect(wordNamed(seen, "SBC HL,BC").columns[0]).toMatchObject({ digit: 5, carryOut: 0 });
    expect(wordNamed(seen, "SBC HL,BC").columns[1]?.carryIn).toBe(0);
  });

  it("adjusts both hex digits of A from H, N, and C", () => {
    expect(daaAdjust(0x10, { h: true, n: false, c: false })).toMatchObject({
      correction: 0x06, after: 0x16, subtract: false, low: true, high: false,
    });
    expect(daaAdjust(0x0a, { h: false, n: false, c: false })).toMatchObject({
      correction: 0x06, after: 0x10, low: true,
    });
    expect(daaAdjust(0x00, { h: true, n: true, c: true })).toMatchObject({
      correction: 0x66, subtract: true,
    });
    const seen = trace(exampleById("arithmetic")?.source ?? "");
    const daa = seen.find((item) => item.mnemonic === "DAA");
    expect(daa?.plan.type).toBe("daa");
    const plan = daa?.plan as DaaMotion;
    expect(plan).toMatchObject({ before: 0x10, after: 0x16, correction: 0x06, h: true, n: false, c: false, subtract: false, low: true });
  });

  it("rolls B for DJNZ and hops only when the branch is taken", () => {
    const seen = trace(exampleById("arithmetic")?.source ?? "");
    const jumps = seen.filter((item) => item.plan.type === "branch").map((item) => item.plan as BranchMotion);
    expect(jumps.map((plan) => `${plan.kind}:${plan.taken ? "taken" : "fall"}:${plan.displacement}`)).toEqual([
      "djnz:taken:-2",
      "djnz:fall:-2",
      "jr:fall:14",
      "jr:taken:1",
    ]);
    expect(jumps[0]).toMatchObject({ before: 2, after: 1, fromLine: jumps[0]?.fromLine, toLine: jumps[0]?.fromLine });
    expect(jumps[1]).toMatchObject({ before: 1, after: 0, taken: false, toLine: undefined });
    expect(jumps[2]?.toLine).toBeUndefined();
    expect(jumps[3]?.toLine).toBeGreaterThan(jumps[3]?.fromLine ?? 0);
  });

  it("rotates the low nibble of A with the two nibbles at (HL)", () => {
    expect(nibbleRotate("rld", 0xf1, 0x23)).toEqual({ a: 0xf2, mem: 0x31 });
    expect(nibbleRotate("rrd", 0xf2, 0x31)).toEqual({ a: 0xf1, mem: 0x23 });
    const seen = trace(exampleById("arithmetic")?.source ?? "");
    const rld = seen.find((item) => item.mnemonic === "RLD")?.plan as NibbleMotion;
    const rrd = seen.find((item) => item.mnemonic === "RRD")?.plan as NibbleMotion;
    expect(rld).toMatchObject({
      op: "rld", aBefore: 0xf1, aAfter: 0xf2, memBefore: 0x23, memAfter: 0x31, address: 0xc000,
    });
    expect(rrd).toMatchObject({
      op: "rrd", aBefore: 0xf2, aAfter: 0xf1, memBefore: 0x31, memAfter: 0x23, address: 0xc000,
    });
  });
});

function aluNamed(seen: { mnemonic: string; plan: MotionPlan }[], mnemonic: string): ArithMotion {
  const step = seen.find((item) => item.mnemonic === mnemonic);
  expect(step?.plan.type, mnemonic).toBe("alu");
  return step?.plan as ArithMotion;
}

function wordNamed(seen: { mnemonic: string; plan: MotionPlan }[], mnemonic: string): WordMotion {
  const step = seen.find((item) => item.mnemonic === mnemonic);
  expect(step?.plan.type, mnemonic).toBe("word");
  return step?.plan as WordMotion;
}
