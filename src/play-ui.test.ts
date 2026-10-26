// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exampleById } from "./examples";
import { COUNTER_MS, MOTION_MS, scaledMs } from "./motion";
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
    document.querySelectorAll(".travel-token, .flying-badge, .flying-stack-mark, .shift-bit, .logic-bit, .logic-op, .logic-result, .logic-board, .counter-roll, .counter-board, .counter-op, .alu-bit, .alu-carry, .alu-board, .alu-op, .alu-result, .word-byte, .word-carry, .word-board, .word-op, .word-result, .daa-board, .daa-flag, .daa-digit, .daa-correction, .daa-result, .branch-hop, .nibble-chip, .nibble-board, .nibble-result").forEach((node) => node.remove());
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

  it("pops AND into both bytes and returns A in the selected format", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    chooseExample(root, "logic");
    click(root, "#step");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "#last-instruction")).toBe("AND A,L");
    expect(text(root, "[data-key='main.a']")).toBe("00");
    expect(root.querySelector("[data-key='main.a']")?.getAttribute("style")).toContain("opacity");
    expect(root.querySelector("[data-key='main.l']")?.getAttribute("style")).toContain("opacity");
    const bits = (row: string) => Array.from(document.querySelectorAll(`.logic-bit[data-row='${row}']`), (node) => node.textContent).join("");
    expect(bits("left")).toBe("11110000");
    expect(bits("right")).toBe("00001111");
    expect(bits("result")).toBe("00000000");
    expect(document.querySelector(".logic-op")?.textContent).toBe("AND");
    expect(document.querySelector(".logic-result")?.textContent).toBe("00");

    click(root, "#format-decimal");
    expect(text(root, "[data-key='main.a']")).toBe("  0");
    expect(document.querySelector(".logic-bit")).toBeNull();
  });

  it("rolls INC digits up and still increments when motion is off", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const editor = editorValue(root);
    editor.value = ["        ORG 0100H", "        LD A, 0FH", "        INC A", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("10");
    expect(root.querySelector("[data-key='main.a']")?.getAttribute("style")).toContain("opacity");
    const roll = document.querySelector(".counter-roll");
    expect(roll?.getAttribute("data-dir")).toBe("inc");
    expect(roll?.getAttribute("data-from")).toBe("0F");
    expect(roll?.getAttribute("data-to")).toBe("10");
    const wheels = Array.from(document.querySelectorAll(".counter-wheel"));
    expect(wheels.map((wheel) => wheel.getAttribute("data-from"))).toEqual(["0", "F"]);
    expect(wheels.map((wheel) => wheel.getAttribute("data-to"))).toEqual(["1", "0"]);
    expect(wheels[1]?.getAttribute("data-turns")).toBe("1");

    click(root, "#motion-toggle");
    click(root, "#reset");
    editor.value = ["        ORG 0100H", "        LD A, 0FH", "        DEC A", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("0E");
    expect(document.querySelector(".counter-wheel")).toBeNull();
    expect(document.querySelector(".logic-bit")).toBeNull();
  });

  it("scales every animation from the speed slider and remembers the choice", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const slider = root.querySelector("#motion-speed");
    expect(slider).toBeInstanceOf(HTMLInputElement);
    if (!(slider instanceof HTMLInputElement)) {
      return;
    }
    expect(slider.value).toBe("1");
    expect(slider.min).toBe("0.1");
    expect(slider.max).toBe("2");
    expect(text(root, "#motion-speed-readout")).toBe("1×");
    expect(root.querySelector("#motion-toggle")?.nextElementSibling).toBe(slider.parentElement);

    const durations = captureDurations(() => {
      chooseExample(root, "exchange");
      click(root, "#step");
    });
    expect(durations).toContain(MOTION_MS);

    slider.value = "0.1";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(text(root, "#motion-speed-readout")).toBe("0.1×");
    expect(localStorage.getItem("z80debug.animationSpeed")).toBe("0.1");
    click(root, "#reset");
    const slow = captureDurations(() => {
      click(root, "#step");
    });
    expect(slow).toContain(scaledMs(MOTION_MS, 0.1));
    expect(Math.max(...slow)).toBeGreaterThan(Math.max(...durations));

    const editor = editorValue(root);
    editor.value = ["        ORG 0100H", "        LD A, 0FH", "        INC A", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    const rolled = captureDurations(() => {
      click(root, "#step");
    });
    expect(rolled).toContain(scaledMs(COUNTER_MS, 0.1));

    click(root, "#motion-toggle");
    click(root, "#reset");
    editor.value = ["        ORG 0100H", "        LD A, 0FH", "        INC A", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("10");
    expect(document.querySelector(".counter-wheel")).toBeNull();
  });

  it("keeps a saved speed that sits between 0.1× and 2×", () => {
    localStorage.setItem("z80debug.animationSpeed", "0.25");
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const slider = root.querySelector("#motion-speed");
    expect(slider).toBeInstanceOf(HTMLInputElement);
    if (!(slider instanceof HTMLInputElement)) {
      return;
    }
    expect(slider.value).toBe("0.25");
    expect(text(root, "#motion-speed-readout")).toBe("0.25×");
  });

  it("stays at 1× when localStorage throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("storage blocked");
    });
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const slider = root.querySelector("#motion-speed");
    expect(slider).toBeInstanceOf(HTMLInputElement);
    if (!(slider instanceof HTMLInputElement)) {
      return;
    }
    expect(slider.value).toBe("1");
    slider.value = "0.5";
    expect(() => slider.dispatchEvent(new Event("input", { bubbles: true }))).not.toThrow();
    expect(text(root, "#motion-speed-readout")).toBe("0.5×");
  });

  it("pauses the current animation and resumes it without changing the machine", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const animations: { playState: string }[] = [];
    const host = animateOwner();
    const original = host.animate;
    host.animate = function () {
      const animation = {
        playState: "running",
        pause() {
          this.playState = "paused";
        },
        play() {
          this.playState = "running";
        },
        cancel() {
          this.playState = "idle";
        },
        onfinish: null,
      };
      animations.push(animation);
      return animation as unknown as Animation;
    };
    try {
      mount(root);
      const speed = root.querySelector("#motion-speed");
      expect(speed?.parentElement?.nextElementSibling).toBe(root.querySelector("#motion-pause"));
      expect(text(root, "#motion-pause")).toBe("Pause");
      chooseExample(root, "exchange");
      click(root, "#step");
      const steps = text(root, "#status");
      const value = text(root, "[data-key='main.a']");
      expect(animations.length).toBeGreaterThan(0);
      click(root, "#motion-pause");
      expect(text(root, "#motion-pause")).toBe("Resume");
      expect(root.querySelector("#motion-pause")?.getAttribute("aria-pressed")).toBe("true");
      expect(animations.every((animation) => animation.playState === "paused")).toBe(true);
      expect(text(root, "#status")).toBe(steps);
      expect(text(root, "[data-key='main.a']")).toBe(value);
      click(root, "#motion-pause");
      expect(text(root, "#motion-pause")).toBe("Pause");
      expect(animations.every((animation) => animation.playState === "running")).toBe(true);
      expect(text(root, "[data-key='main.a']")).toBe(value);
    } finally {
      host.animate = original;
    }
  });

  it("draws add, a 16-bit carry, DAA, a taken hop, and RLD", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const editor = editorValue(root);
    editor.value = ["        ORG 0100H", "        LD A, 63H", "        ADD A, 01H", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("64");
    expect(bitsOf(".alu-bit", "left")).toBe("099");
    expect(bitsOf(".alu-bit", "right")).toBe("001");
    expect(bitsOf(".alu-bit", "result")).toBe("100");
    expect(document.querySelectorAll(".alu-carry").length).toBe(2);
    expect(document.querySelector(".alu-carry")?.getAttribute("data-into")).toBe("1");
    expect(document.querySelector(".alu-result")?.textContent).toBe("64");
    expect(document.querySelector(".alu-result")?.getAttribute("data-stored")).toBe("1");
    expect(document.querySelector(".logic-bit")).toBeNull();

    editor.value = ["        ORG 0100H", "        LD A, 10H", "        CP 10H", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("10");
    expect(bitsOf(".alu-bit", "left")).toBe("016");
    expect(bitsOf(".alu-bit", "right")).toBe("016");
    expect(bitsOf(".alu-bit", "result")).toBe("000");
    expect(document.querySelector(".alu-board")?.getAttribute("data-stored")).toBe("0");
    expect(document.querySelector(".alu-result")?.getAttribute("data-stored")).toBe("0");
    expect(document.querySelector(".alu-result")?.textContent).toBe("00");
    expect(root.querySelector("[data-key='main.a']")?.getAttribute("style") ?? "").not.toContain("opacity");

    editor.value = ["        ORG 0100H", "        LD A, 0FH", "        SCF", "        ADC A, 00H", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("10");
    expect(document.querySelector(".alu-carry[data-incoming='1']")?.textContent).toBe("1");
    expect(document.querySelector(".alu-carry[data-incoming='1']")?.getAttribute("data-kind")).toBe("carry");

    editor.value = ["        ORG 0100H", "        LD A, 01H", "        ADC A, 00H", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(document.querySelector(".alu-carry[data-incoming='1']")?.textContent).toBe("0");

    editor.value = ["        ORG 0100H", "        LD A, 00H", "        SCF", "        SBC A, 00H", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("FF");
    expect(bitsOf(".alu-bit", "result")).toBe("999");
    expect(document.querySelector(".alu-carry[data-incoming='1']")?.getAttribute("data-kind")).toBe("borrow");
    expect(document.querySelector(".alu-result")?.textContent).toBe("FF");

    editor.value = ["        ORG 0100H", "        LD HL, 0063H", "        LD BC, 0001H", "        ADD HL, BC", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.hl']")).toBe("0064");
    expect(bitsOf(".alu-bit", "left")).toBe("00099");
    expect(bitsOf(".alu-bit", "right")).toBe("00001");
    expect(bitsOf(".alu-bit", "result")).toBe("00100");
    expect(document.querySelectorAll(".word-carry").length).toBe(2);
    expect(document.querySelector(".word-carry")?.getAttribute("data-value")).toBe("1");
    expect(document.querySelector(".word-op")?.textContent).toBe("ADD HL");
    expect(document.querySelector(".word-result")?.textContent).toBe("0064");

    editor.value = ["        ORG 0100H", "        LD A, 08H", "        ADD A, 08H", "        DAA", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("16");
    expect(document.querySelector(".daa-digit[data-place='high']")?.getAttribute("data-from")).toBe("1");
    expect(document.querySelector(".daa-digit[data-place='high']")?.getAttribute("data-to")).toBe("1");
    expect(document.querySelector(".daa-digit[data-place='low']")?.getAttribute("data-from")).toBe("0");
    expect(document.querySelector(".daa-digit[data-place='low']")?.getAttribute("data-to")).toBe("6");
    expect(document.querySelector(".daa-flag[data-flag='h']")?.textContent).toBe("H 1");
    expect(document.querySelector(".daa-flag[data-flag='n']")?.textContent).toBe("N 0");
    expect(document.querySelector(".daa-flag[data-flag='c']")?.textContent).toBe("C 0");
    expect(document.querySelector(".daa-correction")?.textContent).toBe("+06");

    editor.value = [
      "        ORG 0100H",
      "        LD B, 02H",
      "AGAIN:  DJNZ AGAIN",
      "        JR Z, STOP",
      "        JR STOP",
      "        HALT",
      "STOP:   HALT",
    ].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(document.querySelector(".counter-op")?.textContent).toBe("DJNZ");
    expect(document.querySelector(".counter-roll")?.getAttribute("data-from")).toBe("02");
    expect(document.querySelector(".counter-roll")?.getAttribute("data-to")).toBe("01");
    expect(document.querySelector(".branch-hop")?.getAttribute("data-taken")).toBe("1");
    expect(document.querySelector(".branch-hop")?.getAttribute("data-displacement")).toBe("-2");
    click(root, "#step");
    expect(document.querySelector(".branch-hop")).toBeNull();
    expect(document.querySelector(".counter-roll")?.getAttribute("data-to")).toBe("00");
    click(root, "#step");
    expect(document.querySelector(".branch-hop")).toBeNull();
    click(root, "#step");
    expect(document.querySelector(".branch-hop")?.getAttribute("data-kind")).toBe("jr");
    expect(document.querySelector(".branch-hop")?.getAttribute("data-taken")).toBe("1");

    editor.value = [
      "        ORG 0100H",
      "        LD HL, 0C000H",
      "        LD (HL), 23H",
      "        LD A, 0F1H",
      "        RLD",
      "        HALT",
    ].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("F2");
    const nibbles = Array.from(document.querySelectorAll(".nibble-chip"), (node) => node.getAttribute("data-value")).sort();
    expect(nibbles).toEqual(["1", "2", "3"]);
    expect(document.querySelector(".nibble-chip[data-from='mem-high']")?.getAttribute("data-to")).toBe("a-low");

    click(root, "#motion-toggle");
    click(root, "#reset");
    editor.value = ["        ORG 0100H", "        LD A, 0FH", "        ADD A, 01H", "        HALT"].join("\n");
    click(root, "#assemble");
    click(root, "#step");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("10");
    expect(document.querySelector(".alu-bit")).toBeNull();
    expect(document.querySelector(".branch-hop")).toBeNull();
  });

  it("runs to a line without motion, steps back, and still has Pause", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    expect(root.querySelector("#motion-pause")?.textContent).toBe("Pause");
    click(root, "#motion-toggle");
    const editor = editorValue(root);
    editor.value = ["        LD A, 1", "        LD A, 2", "        HALT"].join("\n");
    click(root, "#assemble");
    const rows = root.querySelectorAll(".gutter-row.runnable");
    rows[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("#step")?.textContent).toBe("Stop");
    for (let tick = 0; tick < 8; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(text(root, "[data-key='main.a']")).toBe("02");
    expect(root.querySelector("#step")?.textContent).toBe("Step");
    expect(root.querySelector("#status")?.textContent).not.toContain("Halted");
    click(root, "#step-back");
    expect(text(root, "[data-key='main.a']")).toBe("01");
    click(root, "#motion-toggle");
    click(root, "#step");
    expect(text(root, "[data-key='main.a']")).toBe("02");
    expect(document.querySelector(".travel-token")).not.toBeNull();
  });
});

function bitsOf(selector: string, row: string): string {
  return Array.from(document.querySelectorAll(`${selector}[data-row='${row}']`), (node) => node.textContent).join("");
}

function captureDurations(run: () => void): number[] {
  const durations: number[] = [];
  const host = animateOwner();
  const original = host.animate;
  host.animate = function (this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
    const duration = typeof options === "number" ? options : options?.duration;
    if (typeof duration === "number") {
      durations.push(duration);
    }
    if (typeof original === "function") {
      return original.call(this, keyframes, options);
    }
    return {
      playState: "running",
      cancel() {},
      finish() {},
      onfinish: null,
    } as unknown as Animation;
  };
  try {
    run();
  } finally {
    host.animate = original;
  }
  return durations;
}

function animateOwner(): { animate: Element["animate"] } {
  let cursor: object | null = document.createElement("div");
  while (cursor !== null) {
    if (Object.prototype.hasOwnProperty.call(cursor, "animate")) {
      return cursor as { animate: Element["animate"] };
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  return Element.prototype;
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
