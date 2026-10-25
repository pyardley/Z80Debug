import { describe, expect, it } from "vitest";
import { exampleById } from "./examples";
import { Machine } from "./machine";
import {
  captureMotionBase,
  planAfterStep,
  planMotion,
  type MotionFacts,
  type MotionPlan,
} from "./motion";

function facts(partial: Partial<MotionFacts> & Pick<MotionFacts, "mnemonic">): MotionFacts {
  return {
    a: 0,
    af: 0,
    bc: 0,
    de: 0,
    hl: 0,
    sp: 0,
    ix: 0,
    iy: 0,
    i: 0,
    r: 0,
    spBefore: 0,
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
});
