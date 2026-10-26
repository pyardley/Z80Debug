import { describe, expect, it } from "vitest";
import { formatWord } from "./format";
import {
  formatStackLabel,
  recordStackStep,
  stackWordValue,
  type StackWord,
} from "./stack";

function run(steps: Array<{ mnemonic: string; spBefore: number; spAfter: number; writes?: number[] }>): Map<number, StackWord> {
  const notes = new Map<number, StackWord>();
  const touched = new Set<number>();
  for (const step of steps) {
    recordStackStep(
      notes,
      touched,
      step.mnemonic,
      step.spBefore,
      step.spAfter,
      (step.writes ?? []).map((address) => ({ address })),
    );
  }
  return notes;
}

describe("stack words", () => {
  it("shows bytes EF then BE as the pair BEEF", () => {
    expect(stackWordValue(0xef, 0xbe)).toBe(0xbeef);
    expect(formatWord(stackWordValue(0xef, 0xbe), "hex")).toBe("BEEF");
  });

  it("labels PUSH BC and reports POP DE as BC → DE", () => {
    const notes = run([
      { mnemonic: "PUSH BC", spBefore: 0xff00, spAfter: 0xfefe, writes: [0xfefe, 0xfeff] },
    ]);
    expect(notes.get(0xfefe)).toEqual({ source: "BC" });
    expect(formatStackLabel(notes.get(0xfefe))).toBe("BC");

    const afterPop = run([
      { mnemonic: "PUSH BC", spBefore: 0xff00, spAfter: 0xfefe, writes: [0xfefe, 0xfeff] },
      { mnemonic: "POP DE", spBefore: 0xfefe, spAfter: 0xff00 },
    ]);
    expect(afterPop.get(0xfefe)).toEqual({ source: "BC", dest: "DE" });
    expect(formatStackLabel(afterPop.get(0xfefe))).toBe("BC → DE");
  });

  it("labels CALL as return and leaves a plain store as data", () => {
    const notes = run([
      { mnemonic: "CALL 0X010C", spBefore: 0xfefe, spAfter: 0xfefc, writes: [0xfefc, 0xfefd] },
    ]);
    expect(formatStackLabel(notes.get(0xfefc))).toBe("return");

    const stored = run([
      { mnemonic: "PUSH BC", spBefore: 0xff00, spAfter: 0xfefe, writes: [0xfefe, 0xfeff] },
      { mnemonic: "LD (HL),A", spBefore: 0xfefe, spAfter: 0xfefe, writes: [0xfefe] },
    ]);
    expect(formatStackLabel(stored.get(0xfefe))).toBe("data");

    const fresh = run([
      { mnemonic: "LD (0XC000),HL", spBefore: 0xff00, spAfter: 0xff00, writes: [0xc000, 0xc001] },
    ]);
    expect(formatStackLabel(fresh.get(0xc000))).toBe("data");
  });

  it("keeps BC → DE until the word is overwritten", () => {
    const notes = run([
      { mnemonic: "PUSH BC", spBefore: 0xff00, spAfter: 0xfefe, writes: [0xfefe, 0xfeff] },
      { mnemonic: "POP DE", spBefore: 0xfefe, spAfter: 0xff00 },
      { mnemonic: "NOP", spBefore: 0xff00, spAfter: 0xff00 },
    ]);
    expect(formatStackLabel(notes.get(0xfefe))).toBe("BC → DE");

    const replaced = run([
      { mnemonic: "PUSH BC", spBefore: 0xff00, spAfter: 0xfefe, writes: [0xfefe, 0xfeff] },
      { mnemonic: "POP DE", spBefore: 0xfefe, spAfter: 0xff00 },
      { mnemonic: "PUSH HL", spBefore: 0xff00, spAfter: 0xfefe, writes: [0xfefe, 0xfeff] },
    ]);
    expect(formatStackLabel(replaced.get(0xfefe))).toBe("HL");
  });
});
