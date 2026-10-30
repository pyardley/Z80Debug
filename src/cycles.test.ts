import { describe, expect, it } from "vitest";
import { baseCycles, cyclesSuffix } from "./cycles";

describe("documented cycle counts", () => {
  it("uses the single documented count", () => {
    expect(baseCycles([0x00])).toBe(4);
    expect(baseCycles([0x31, 0xff, 0x00])).toBe(10);
    expect(baseCycles([0xdd, 0x21, 0x00, 0x40])).toBe(14);
    expect(baseCycles([0x18, 0x00])).toBe(12);
    expect(baseCycles([0xc3, 0x00, 0x01])).toBe(10);
    expect(baseCycles([0xcd, 0x00, 0x01])).toBe(17);
    expect(baseCycles([0xc9])).toBe(10);
    expect(baseCycles([0x76])).toBe(4);
    expect(baseCycles([0xdd, 0x67])).toBe(8);
    expect(cyclesSuffix([0x31, 0xff, 0x00])).toBe("    cycles 10");
  });

  it("omits a form that has two documented counts", () => {
    expect(baseCycles([0x10, 0xfe])).toBeUndefined();
    expect(baseCycles([0x20, 0x00])).toBeUndefined();
    expect(baseCycles([0xc0])).toBeUndefined();
    expect(baseCycles([0xed, 0xb0])).toBeUndefined();
    expect(baseCycles([0xdd, 0xcb, 0x01])).toBeUndefined();
    expect(baseCycles([])).toBeUndefined();
    expect(cyclesSuffix([0x10, 0xfe])).toBe("");
  });
});
