import { describe, expect, it } from "vitest";
import { exampleById } from "./examples";
import { Machine } from "./machine";
import {
  captureMotionBase,
  planAfterStep,
  planMotion,
  shiftTracks,
  type BitMotion,
  type MotionFacts,
  type MotionPlan,
  type ShiftKind,
  type ShiftMotion,
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

  it("carries a word immediate into BC", () => {
    const plan = planMotion(facts({ mnemonic: "LD BC,0X1111", bc: 0x1111 }));
    expect(plan).toMatchObject({
      type: "travel",
      moves: [{ from: { type: "source" }, to: { type: "reg", name: "bc" }, value: 0x1111, width: 16 }],
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
      moves: [{ from: { type: "reg", name: "bc" }, to: { type: "mem", address: 0xfefe }, value: 0xbeef, width: 16, label: "BC" }],
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
      moves: [{ from: { type: "mem", address: 0xfefe }, to: { type: "reg", name: "de" }, value: 0xbeef, label: "BC → DE" }],
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
