// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import { FORMAT_STORAGE_KEY } from "./format";
import { mount } from "./ui";

describe("format control", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it("lists Hex, Decimal, Binary, and ASCII in that order", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const labels = Array.from(root.querySelectorAll(".format button"), (button) => button.textContent);
    expect(labels).toEqual(["Hex", "Decimal", "Binary", "ASCII"]);
  });

  it("shows a known sample byte as ASCII and leaves the machine unstepped", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const assemble = root.querySelector("#assemble");
    if (!(assemble instanceof HTMLButtonElement)) {
      throw new Error("missing Assemble");
    }
    assemble.click();
    const ascii = root.querySelector("#format-ascii");
    if (!(ascii instanceof HTMLButtonElement)) {
      throw new Error("missing ASCII");
    }
    ascii.click();

    expect(localStorage.getItem(FORMAT_STORAGE_KEY)).toBe("ascii");
    const status = root.querySelector("#status")?.textContent ?? "";
    expect(status).toContain("Values shown in ASCII");
    expect(status).toContain("Steps: 0");
    expect(root.querySelector("#memory-pc .ascii")).toBeNull();

    const glyphs = Array.from(root.querySelectorAll("#memory-pc .mem-byte"), (cell) => cell.textContent);
    expect(glyphs).toContain("1");
    expect(glyphs).toContain("<");
  });
});
