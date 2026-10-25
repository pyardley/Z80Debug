// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORMAT_STORAGE_KEY } from "./format";
import { CONSOLE_SOURCE, SAMPLE_SOURCE } from "./sample";
import { mount } from "./ui";

function click(root: ParentNode, selector: string): void {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing ${selector}`);
  }
  element.click();
}

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

describe("storage failure", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the page in hex when localStorage throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.");
    });
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);

    expect(root.querySelector("h1")?.textContent).toBe("Z80Debug");
    expect(root.querySelector("#editor")).toBeInstanceOf(HTMLTextAreaElement);
    expect(root.querySelector("#console-output")).not.toBeNull();
    expect(root.querySelector("#format-hex")?.getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector("#format-hex")?.classList.contains("selected")).toBe(true);

    click(root, "#format-ascii");
    expect(root.querySelector("#format-ascii")?.getAttribute("aria-checked")).toBe("true");
    click(root, "#assemble");
    const status = root.querySelector("#status")?.textContent ?? "";
    expect(status).toContain("Values shown in ASCII");
    expect(status).toContain("Steps: 0");
  });

  it("still draws when saving the format throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.");
    });
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    expect(root.querySelector("#format-hex")?.getAttribute("aria-checked")).toBe("true");

    click(root, "#format-decimal");
    expect(root.querySelector("#format-decimal")?.getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector("#editor")).toBeInstanceOf(HTMLTextAreaElement);
  });
});

describe("console panel", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it("documents the ports and loads either sample", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const ports = root.querySelector(".console-ports")?.textContent ?? "";
    expect(ports).toContain("00H");
    expect(ports).toContain("OUT (00H),A");
    expect(ports).toContain("IN A,(00H)");
    expect(ports).toContain("01H");
    expect(ports).toContain("0FFH");
    expect(ports).toContain("CR+LF");

    click(root, "#load-console");
    const editor = root.querySelector("#editor");
    if (!(editor instanceof HTMLTextAreaElement)) {
      throw new Error("missing editor");
    }
    expect(editor.value).toBe(CONSOLE_SOURCE);
    expect(root.querySelector("#status")?.textContent).toContain("Ready");
    expect(root.querySelector("#console-output")?.textContent).toBe("");

    click(root, "#load-sample");
    expect(editor.value).toBe(SAMPLE_SOURCE);
    expect(root.querySelector("#next-instruction")?.textContent).toContain("LD SP,0XFF00");
  });

  it("shows each OUT immediately, then reads one queued character", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    click(root, "#load-console");

    click(root, "#step");
    expect(root.querySelector("#console-output")?.textContent).toBe("");
    click(root, "#step");
    expect(root.querySelector("#console-output")?.textContent).toBe("H");
    for (let count = 0; count < 6; count += 1) {
      click(root, "#step");
    }
    expect(root.querySelector("#console-output")?.textContent).toBe("Hi? ");
    expect(root.querySelector("#console-waiting")?.textContent).toBe("Waiting: 0");
    expect(root.querySelector("#next-instruction")?.textContent).toContain("IN A,(0X00)");

    const input = root.querySelector("#console-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("missing console input");
    }
    input.value = "Q";
    click(root, "#console-form button");
    expect(root.querySelector("#console-waiting")?.textContent).toBe("Waiting: 1 (Q)");
    expect(input.value).toBe("");

    click(root, "#step");
    expect(root.querySelector("[data-key='main.a']")?.textContent).toBe("51");
    expect(root.querySelector("#console-waiting")?.textContent).toBe("Waiting: 0");
    expect(root.querySelector("#console-output")?.textContent).toBe("Hi? ");

    click(root, "#format-ascii");
    expect(root.querySelector("[data-key='main.a']")?.textContent).toBe("Q");
    expect(root.querySelector("#console-output")?.textContent).toBe("Hi? ");
  });

  it("Clear and Reset empty the screen and the queue", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    click(root, "#load-console");
    click(root, "#step");
    click(root, "#step");
    const input = root.querySelector("#console-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("missing console input");
    }
    input.value = "Q";
    click(root, "#console-form button");
    expect(root.querySelector("#console-output")?.textContent).toBe("H");
    expect(root.querySelector("#console-waiting")?.textContent).toBe("Waiting: 1 (Q)");
    const steps = root.querySelector("#status")?.textContent;

    click(root, "#console-clear");
    expect(root.querySelector("#console-output")?.textContent).toBe("");
    expect(root.querySelector("#console-waiting")?.textContent).toBe("Waiting: 0");
    expect(root.querySelector("#status")?.textContent).toBe(steps);
    expect(root.querySelector("[data-key='main.a']")?.textContent).toBe("48");

    input.value = "Z";
    click(root, "#console-form button");
    click(root, "#step");
    click(root, "#reset");
    expect(root.querySelector("#console-output")?.textContent).toBe("");
    expect(root.querySelector("#console-waiting")?.textContent).toBe("Waiting: 0");
    expect(root.querySelector("#status")?.textContent).toContain("Steps: 0");
  });
});
