// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exampleById } from "./examples";
import { mount } from "./play-ui";

function click(root: ParentNode, selector: string): void {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing ${selector}`);
  }
  element.click();
}

function chooseExample(root: ParentNode, id: string): void {
  const select = root.querySelector("#examples");
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error("missing examples");
  }
  select.value = id;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function editorValue(root: ParentNode): HTMLTextAreaElement {
  const editor = root.querySelector("#editor");
  if (!(editor instanceof HTMLTextAreaElement)) {
    throw new Error("missing editor");
  }
  return editor;
}

function text(root: ParentNode, selector: string): string {
  return root.querySelector(selector)?.textContent ?? "";
}

describe("tabletop debugger", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.querySelectorAll(".travel-token, .flying-badge, .flying-stack-mark, .shift-bit").forEach((node) => node.remove());
  });

  it("sends an immediate on a chip and keeps the register correct", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    chooseExample(root, "exchange");
    click(root, "#step");

    expect(text(root, "[data-key='main.a']")).toBe("11");
    expect(text(root, "#status")).toContain("Steps: 1");
    const token = document.querySelector(".travel-token");
    expect(token?.textContent).toBe("11");
    expect(token?.getAttribute("data-value")).toBe("17");

    click(root, "#step");
    expect(text(root, "[data-key='main.bc']")).toBe("1111");
    expect(document.querySelectorAll(".travel-token")).toHaveLength(1);
    expect(document.querySelector(".travel-token")?.textContent).toBe("1111");
  });

  it("updates the register when motion is off", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    click(root, "#motion-toggle");
    expect(root.querySelector("#motion-toggle")?.getAttribute("aria-pressed")).toBe("false");
    chooseExample(root, "exchange");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("11");
    expect(document.querySelector(".travel-token")).toBeNull();
  });

  it("slides the AF tags and leaves the EXX tags", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    chooseExample(root, "exchange");
    for (let step = 0; step < 5; step++) {
      click(root, "#step");
    }

    expect(text(root, "[data-badge='af'][data-side='main']")).toBe("Shadow");
    expect(text(root, "[data-badge='af'][data-side='alt']")).toBe("Active");
    expect(text(root, "[data-badge='exx'][data-side='main']")).toBe("Active");
    expect(text(root, "[data-badge='exx'][data-side='alt']")).toBe("Shadow");
    expect(text(root, "[data-key='main.a']")).toBe("11");
    expect(text(root, "[data-key='alt.a']")).toBe("00");
    const flying = Array.from(document.querySelectorAll(".flying-badge"), (node) => node.textContent).sort();
    expect(flying).toEqual(["Active", "Shadow"]);

    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='alt.a']")).toBe("AA");
    expect(text(root, "[data-key='main.a']")).toBe("11");
    expect(text(root, "[data-badge='exx'][data-side='main']")).toBe("Shadow");
    expect(text(root, "[data-badge='exx'][data-side='alt']")).toBe("Active");
    expect(text(root, "[data-badge='af'][data-side='main']")).toBe("Shadow");
    expect(document.querySelectorAll(".flying-badge")).toHaveLength(2);
  });

  it("asks before replacing unsaved edits and before Quit", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const editor = editorValue(root);
    editor.value = `${editor.value}\n; edited`;
    editor.dispatchEvent(new Event("input"));
    expect(text(root, "#loaded-name")).toBe("sample.asm (unsaved)");

    chooseExample(root, "flags");
    expect(confirm).toHaveBeenCalledWith("Discard unsaved edits to sample.asm?");
    expect(editor.value).toContain("; edited");

    confirm.mockReturnValue(true);
    click(root, "#load-example");
    expect(editor.value).toBe(exampleById("sample")?.source);
    chooseExample(root, "console-echo");
    expect(text(root, "#loaded-name")).toBe("console-echo.asm");
    expect(editor.value).toContain("IN A, (00H)");

    click(root, "#file-new");
    expect(editor.value).toBe("");
    expect(text(root, "#loaded-name")).toBe("Untitled");

    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    editor.value = "dirty again";
    confirm.mockReturnValue(false);
    click(root, "#file-quit");
    expect(close).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    click(root, "#file-quit");
    expect(close).toHaveBeenCalled();
    vi.runAllTimers();
    expect(text(root, "#file-status")).toBe("The browser kept this page open.");
  });

  it("saves with the same shortcut", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const editor = editorValue(root);
    const input = root.querySelector("#file-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("missing file input");
    }
    vi.spyOn(input, "click").mockImplementation(() => {
      const file = new File(["        LD A, 1\n"], "mine.asm");
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      input.dispatchEvent(new Event("change"));
    });
    click(root, "#file-open");
    await flush();
    expect(editor.value).toContain("LD A, 1");

    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this);
    });
    editor.value = "        HALT\n";
    const event = new KeyboardEvent("keydown", { code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(clicks.some((link) => link.download === "mine.asm")).toBe(true);
    expect(text(root, "#file-status")).toContain("Downloaded mine.asm");
  });

  it("flies a push onto the stack column and moves the pointer back on RET", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    expect(root.querySelector(".desk > .memory-pane #memory-stack")).not.toBeNull();
    expect(root.querySelector(".toy #memory-stack")).toBeNull();

    chooseExample(root, "stack");
    click(root, "#step");
    click(root, "#step");
    click(root, "#step");

    const top = root.querySelector("#memory-stack [data-stack-top='true']");
    expect(top?.textContent).toContain("FEFE");
    expect(top?.textContent).toContain("▶ SP");
    expect(top?.textContent).toContain("BEEF");
    expect(top?.querySelector("[data-label]")?.textContent).toBe("BC");
    expect(top?.querySelector(".mem-byte")?.textContent).toBe("BEEF");
    expect(document.querySelector(".travel-token")?.textContent).toBe("BC BEEF");
    expect(document.querySelector(".flying-stack-mark")?.textContent).toContain("SP");

    click(root, "#motion-toggle");
    click(root, "#step");
    click(root, "#step");
    expect(document.querySelector(".travel-token")).toBeNull();
    expect(document.querySelector(".flying-stack-mark")).toBeNull();
    expect(root.querySelector("#memory-stack [data-stack-top='true']")?.textContent).toContain("FEFE");
    click(root, "#step");
    expect(root.querySelector("#memory-stack [data-stack-top='true']")?.textContent).toContain("FF00");
    const word = root.querySelector("#memory-stack [data-addr='65278']");
    expect(word?.textContent).toBe("BEEF");
    expect(word?.parentElement?.querySelector("[data-label]")?.textContent).toBe("BC → DE");
  });

  it("pops RLA into bits and puts A back in the selected format", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    chooseExample(root, "shifts");
    click(root, "#step");
    click(root, "#step");

    expect(text(root, "#last-instruction")).toBe("RLA");
    expect(text(root, "[data-key='main.a']")).toBe("02");
    expect(root.querySelector("[data-key='main.a']")?.getAttribute("style")).toContain("opacity");
    const bits = Array.from(document.querySelectorAll(".shift-bit"));
    expect(bits.length).toBeGreaterThanOrEqual(8);
    const original = new Map<string, string>();
    for (const bit of bits) {
      if (bit.getAttribute("data-from") === "bit") {
        const slot = bit.getAttribute("data-from-slot");
        if (slot !== null) {
          original.set(slot, bit.textContent ?? "");
        }
      }
    }
    expect(Array.from({ length: 8 }, (_, slot) => original.get(String(slot))).join("")).toBe("10000001");
    expect(bits.some((bit) => bit.getAttribute("data-to") === "carry" && bit.textContent === "1")).toBe(true);
    expect(bits.some((bit) => bit.getAttribute("data-from") === "carry" && bit.textContent === "0")).toBe(true);
    expect(root.querySelector("[data-flag='c'][data-side='main']")?.getAttribute("data-set")).toBe("0");
    expect(root.querySelector("[data-flag='s'][data-side='main']")?.classList.contains("set")).toBe(false);

    click(root, "#format-decimal");
    expect(text(root, "[data-key='main.a']")).toBe("  2");
    expect(text(root, "[data-key='main.a']")).not.toBe("00000010");
  });

  it("keeps the result and Carry when motion is off", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    click(root, "#motion-toggle");
    chooseExample(root, "shifts");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("02");
    expect(root.querySelector("[data-flag='c'][data-side='main']")?.getAttribute("data-set")).toBe("1");
    expect(document.querySelector(".shift-bit")).toBeNull();
  });

  it("holds S, Z, and P/V until a CB rotate settles, and pops (HL)", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const editor = editorValue(root);
    editor.value = [
      "        ORG 0100H",
      "        LD A, 81H",
      "        RLC A",
      "        LD HL, 0C000H",
      "        LD (HL), 81H",
      "        RL (HL)",
      "        HALT",
    ].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("03");
    expect(root.querySelector("[data-flag='c'][data-side='main']")?.getAttribute("data-set")).toBe("0");
    expect(root.querySelector("[data-flag='pv'][data-side='main']")?.getAttribute("data-set")).toBe("0");
    expect(root.querySelector("[data-flag='h'][data-side='main']")?.getAttribute("data-set")).toBe("0");
    expect(document.querySelector(".shift-bit[data-to='bit'][data-to-slot='7']")?.textContent).toBe("1");

    click(root, "#step");
    click(root, "#step");
    click(root, "#step");
    const cell = root.querySelector("#memory-focus [data-addr='49152']");
    expect(cell?.textContent).toBe("03");
    expect(cell?.getAttribute("style")).toContain("opacity");
    expect(root.querySelector("[data-key='main.a']")?.getAttribute("style") ?? "").not.toContain("opacity");
    expect(document.querySelectorAll(".shift-bit").length).toBeGreaterThanOrEqual(8);
  });

  it("explains every flag from the letter and its 0 or 1", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    for (const [key, sentence] of [
      ["s", "S, Sign."],
      ["z", "Z, Zero."],
      ["h", "H, Half carry."],
      ["pv", "P/V, Parity or overflow."],
      ["n", "N, Subtract."],
      ["c", "C, Carry."],
    ] as const) {
      const flag = root.querySelector(`[data-flag='${key}'][data-side='main']`);
      expect(flag?.querySelector(".flag-name")?.textContent).toBe(key === "pv" ? "P/V" : key.toUpperCase());
      expect(flag?.querySelector(".flag-state")?.textContent).toMatch(/^[01]$/);
      expect(flag?.querySelector(".flag-bubble")?.textContent?.startsWith(sentence)).toBe(true);
    }
    expect(root.querySelector("[data-flag='c'] .flag-bubble")?.textContent).toBe(
      "C, Carry. Set when an unsigned add or subtract does not fit, or when a shift or rotate pushes a bit out.",
    );
  });

  it("pops SET into bits and returns A in the selected format", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    chooseExample(root, "bits");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "#last-instruction")).toBe("SET 0,A");
    expect(text(root, "[data-key='main.a']")).toBe("01");
    expect(root.querySelector("[data-key='main.a']")?.getAttribute("style")).toContain("opacity");
    const chosen = document.querySelector(".shift-bit.chosen");
    expect(chosen?.getAttribute("data-from-slot")).toBe("7");
    expect(chosen?.textContent).toBe("0");
    expect(chosen?.getAttribute("data-op")).toBe("set");
    expect(root.querySelector("[data-flag='z'][data-side='main']")?.getAttribute("data-set")).toBe("0");
    expect(root.querySelector("[data-flag='c'][data-side='main']")?.getAttribute("data-set")).toBe("0");

    click(root, "#format-decimal");
    expect(text(root, "[data-key='main.a']")).toBe("  1");
  });

  it("holds Z until BIT shows the opposite of the tested bit", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const editor = editorValue(root);
    editor.value = ["        ORG 0100H", "        LD A, 00H", "        BIT 0, A", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("00");
    expect(root.querySelector("[data-flag='z'][data-side='main']")?.getAttribute("data-set")).toBe("0");
    expect(document.querySelector(".shift-bit.chosen")?.textContent).toBe("0");
    expect(document.querySelector(".shift-bit[data-to='z']")?.textContent).toBe("1");

    click(root, "#motion-toggle");
    click(root, "#reset");
    editor.value = ["        ORG 0100H", "        LD A, 01H", "        BIT 0, A", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("01");
    expect(root.querySelector("[data-flag='z'][data-side='main']")?.getAttribute("data-set")).toBe("0");
    expect(document.querySelector(".shift-bit")).toBeNull();
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
