import { describe, expect, it } from "vitest";
import { destinationKeys, trailingComment } from "./comments";
import { exampleById } from "./examples";
import { Machine } from "./machine";

const main = { af: "main" as const, exx: "main" as const };

describe("trailing comments", () => {
  it("keeps the text after the semicolon", () => {
    expect(trailingComment("        LD A, 11H       ; page number")).toBe("page number");
    expect(trailingComment("        LD A, 11H")).toBeUndefined();
    expect(trailingComment("        LD A, 11H ;")).toBeUndefined();
    expect(trailingComment(undefined)).toBeUndefined();
  });

  it("names the register a load or arithmetic instruction writes", () => {
    expect(destinationKeys("LD A,0X11", main)).toEqual(["main.a"]);
    expect(destinationKeys("LD (HL),A", main)).toEqual([]);
    expect(destinationKeys("LD A,(HL)", main)).toEqual(["main.a"]);
    expect(destinationKeys("LD DE,0X4455", main)).toEqual(["main.d", "main.e"]);
    expect(destinationKeys("LD IX,0X4000", main)).toEqual(["ixh", "ixl"]);
    expect(destinationKeys("LD IXH,A", main)).toEqual(["ixh"]);
    expect(destinationKeys("LD SP,0XFF00", main)).toEqual(["sp"]);
    expect(destinationKeys("LD I,A", main)).toEqual(["i"]);
    expect(destinationKeys("LD R,A", main)).toEqual(["r"]);
    expect(destinationKeys("LD A,I", main)).toEqual(["main.a"]);
    expect(destinationKeys("ADD A,B", main)).toEqual(["main.a"]);
    expect(destinationKeys("ADD HL,BC", main)).toEqual(["main.h", "main.l"]);
    expect(destinationKeys("AND 0XF0", main)).toEqual(["main.a"]);
    expect(destinationKeys("OR A,B", main)).toEqual(["main.a"]);
    expect(destinationKeys("CP B", main)).toEqual([]);
    expect(destinationKeys("INC (HL)", main)).toEqual([]);
    expect(destinationKeys("INC BC", main)).toEqual(["main.b", "main.c"]);
    expect(destinationKeys("POP AF", main)).toEqual(["main.a", "main.f"]);
    expect(destinationKeys("PUSH BC", main)).toEqual([]);
    expect(destinationKeys("SET 0,B", main)).toEqual(["main.b"]);
    expect(destinationKeys("BIT 0,A", main)).toEqual([]);
    expect(destinationKeys("RES 1,(HL)", main)).toEqual([]);
    expect(destinationKeys("RL (HL)", main)).toEqual([]);
    expect(destinationKeys("RLA", main)).toEqual(["main.a"]);
    expect(destinationKeys("EX DE,HL", main)).toEqual(["main.d", "main.e", "main.h", "main.l"]);
    expect(destinationKeys("EX AF,AF'", main).sort()).toEqual(["alt.a", "alt.f", "main.a", "main.f"]);
    expect(destinationKeys("EXX", main)).toHaveLength(12);
    expect(destinationKeys("DJNZ 0X0100", main, true).sort()).toEqual(["main.b", "pc"]);
    expect(destinationKeys("DJNZ 0X0104", main, false)).toEqual(["main.b"]);
    expect(destinationKeys("JR NZ,0X0108", main, true)).toEqual(["pc"]);
    expect(destinationKeys("NOP", main)).toEqual([]);
    expect(destinationKeys("LD B,0X22", { af: "main", exx: "alt" })).toEqual(["alt.b"]);
  });
});

describe("register comment bubbles", () => {
  it("follows the latest write and leaves an uncommented register alone", () => {
    const machine = new Machine();
    expect(machine.assemble(exampleById("comments")?.source ?? "")).toBe(true);
    const comments = new Map<string, string>();
    while (!machine.halted && machine.steps < 20) {
      machine.step();
      for (const key of ["main.a", "main.b", "main.c", "main.d", "main.e", "main.h", "main.l", "ixh", "ixl", "iyh", "iyl", "sp", "pc", "i", "r"]) {
        const comment = machine.registerComment(key);
        if (comment !== undefined) {
          comments.set(key, comment);
        }
      }
    }
    expect(machine.halted).toBe(true);
    expect(comments.get("main.a")).toBe("current page");
    expect(machine.registerComment("main.b")).toBe("row");
    expect(machine.registerComment("main.c")).toBe("column");
    expect(machine.registerComment("main.d")).toBe("range start");
    expect(machine.registerComment("main.e")).toBe("range start");
    expect(machine.registerComment("main.h")).toBe("range end");
    expect(machine.registerComment("main.l")).toBe("range end");
    expect(machine.registerComment("ixh")).toBe("pixel buffer");
    expect(machine.registerComment("ixl")).toBe("pixel buffer");
    expect(machine.registerComment("iyh")).toBe("name table");
    expect(machine.registerComment("iyl")).toBe("name table");
    expect(machine.registerComment("sp")).toBe("stack top");
    expect(machine.registerComment("pc")).toBeUndefined();
    expect(machine.registerComment("i")).toBeUndefined();
    expect(machine.registerComment("r")).toBeUndefined();
    expect(machine.registerComment("main.f")).toBeUndefined();

    machine.stepBack();
    expect(machine.registerComment("main.a")).toBe("current page");
    machine.stepBack();
    expect(machine.registerComment("main.a")).toBe("page number");
  });

  it("clears a comment when a later write has none", () => {
    const machine = new Machine();
    expect(machine.assemble(`
        ORG 0100H
        LD A, 11H       ; page number
        LD A, 22H
        LD SP, 0FF00H   ; stack top
        LD SP, HL
        HALT
    `)).toBe(true);
    machine.step();
    expect(machine.registerComment("main.a")).toBe("page number");
    machine.step();
    expect(machine.registerComment("main.a")).toBeUndefined();
    machine.step();
    expect(machine.registerComment("sp")).toBe("stack top");
    machine.step();
    expect(machine.registerComment("sp")).toBeUndefined();
    expect(machine.registerComment("main.h")).toBeUndefined();
  });
});
