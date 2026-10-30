// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSOLE_SOURCE, EXAMPLES, SAMPLE_SOURCE } from "./examples";
import { FORMAT_STORAGE_KEY } from "./format";
import { mount } from "./ui";

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

    const labels = Array.from(root.querySelectorAll("#examples option"), (option) => option.textContent);
    expect(labels).toEqual(["Examples", ...EXAMPLES.map((example) => example.label)]);
    expect(root.querySelector("#loaded-name")?.textContent).toBe("sample.asm");

    chooseExample(root, "console");
    const editor = editorValue(root);
    expect(editor.value).toBe(CONSOLE_SOURCE);
    expect(root.querySelector("#loaded-name")?.textContent).toBe("console.asm");
    expect(root.querySelector("#status")?.textContent).toContain("Ready");
    expect(root.querySelector("#console-output")?.textContent).toBe("");

    chooseExample(root, "sample");
    expect(editor.value).toBe(SAMPLE_SOURCE);
    expect(root.querySelector("#loaded-name")?.textContent).toBe("sample.asm");
    expect(root.querySelector("#next-instruction")?.textContent).toContain("LD SP,0XFF00");
  });

  it("keeps memory and the stack in the right-hand column", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    expect(root.querySelector(".bench > .memory-pane #memory-pc")).not.toBeNull();
    expect(root.querySelector(".bench > .memory-pane #memory-focus")).not.toBeNull();
    expect(root.querySelector(".workspace #memory-stack")).toBeNull();
    expect(root.querySelector("#memory-stack")).not.toBeNull();

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
    expect(top?.querySelector(".mem-byte")?.classList.contains("changed")).toBe(true);
    expect(Array.from(root.querySelectorAll("[data-key='sp']"), (cell) => cell.textContent)).toEqual(["FEFE", "FEFE"]);

    click(root, "#step");
    click(root, "#step");
    expect(root.querySelector("#memory-stack [data-stack-top='true']")?.textContent).toContain("FEFE");
    click(root, "#step");
    expect(root.querySelector("#memory-stack [data-stack-top='true']")?.textContent).toContain("FF00");
    expect(root.querySelector("[data-key='main.d']")?.textContent).toBe("BE");
    expect(root.querySelector("[data-key='main.e']")?.textContent).toBe("EF");
    expect(root.querySelector("[data-key='main.de']")).toBeNull();
    const word = root.querySelector("#memory-stack [data-addr='65278']");
    expect(word?.textContent).toBe("BEEF");
    expect(word?.parentElement?.querySelector("[data-label]")?.textContent).toBe("BC → DE");
  });

  it("shows each OUT immediately, then reads one queued character", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    chooseExample(root, "console");

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
    chooseExample(root, "console");
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

describe("file menu", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
  });

  it("loads an example by name and asks before replacing unsaved edits", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const editor = editorValue(root);
    editor.value = `${editor.value}\n; edited`;
    editor.dispatchEvent(new Event("input"));
    expect(root.querySelector("#loaded-name")?.textContent).toBe("sample.asm (unsaved)");

    chooseExample(root, "flags");
    expect(confirm).toHaveBeenCalledWith("Discard unsaved edits to sample.asm?");
    expect(editor.value).toContain("; edited");
    expect(root.querySelector("#loaded-name")?.textContent).toBe("sample.asm (unsaved)");

    confirm.mockReturnValue(true);
    click(root, "#load-example");
    expect(editor.value).toBe(SAMPLE_SOURCE);
    expect(root.querySelector("#loaded-name")?.textContent).toBe("sample.asm");

    chooseExample(root, "console-echo");
    expect(root.querySelector("#loaded-name")?.textContent).toBe("console-echo.asm");
    expect(editor.value).toContain("IN A, (00H)");
  });

  it("opens and saves through the file picker", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    let written = "";
    const handle = {
      name: "greet.asm",
      async getFile() {
        return new File(["        ORG 0100H\n        NOP\n"], "greet.asm");
      },
      async createWritable() {
        return {
          async write(data: string) {
            written = data;
          },
          async close() {},
        };
      },
    };
    window.showOpenFilePicker = async () => [handle as unknown as FileSystemFileHandle];
    window.showSaveFilePicker = async () => handle as unknown as FileSystemFileHandle;

    click(root, "#file-open");
    await flush();
    const editor = editorValue(root);
    expect(editor.value).toContain("NOP");
    expect(root.querySelector("#loaded-name")?.textContent).toBe("greet.asm");
    expect(root.querySelector("#file-status")?.textContent).toBe("Opened greet.asm.");

    editor.value = editor.value.replace("NOP", "HALT");
    editor.dispatchEvent(new Event("input"));
    click(root, "#file-save");
    await flush();
    expect(written).toContain("HALT");
    expect(written).not.toContain("NOP");
    expect(root.querySelector("#loaded-name")?.textContent).toBe("greet.asm");
    expect(root.querySelector("#file-status")?.textContent).toBe("Saved greet.asm.");
  });

  it("falls back to a file input and a download", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const editor = editorValue(root);
    const input = root.querySelector("#file-input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("missing file input");
    }
    const opened = vi.spyOn(input, "click").mockImplementation(() => {
      const file = new File(["        LD A, 1\n"], "mine.asm");
      Object.defineProperty(input, "files", { configurable: true, value: [file] });
      input.dispatchEvent(new Event("change"));
    });

    click(root, "#file-open");
    await flush();
    expect(opened).toHaveBeenCalled();
    expect(editor.value).toContain("LD A, 1");
    expect(root.querySelector("#loaded-name")?.textContent).toBe("mine.asm");

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
    expect(root.querySelector("#file-status")?.textContent).toContain("Downloaded mine.asm");
  });

  it("asks before New and says when Quit leaves the page open", () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const editor = editorValue(root);
    editor.value = "dirty";
    editor.dispatchEvent(new Event("input"));

    click(root, "#file-new");
    expect(editor.value).toBe("dirty");
    confirm.mockReturnValue(true);
    click(root, "#file-new");
    expect(editor.value).toBe("");
    expect(root.querySelector("#loaded-name")?.textContent).toBe("Untitled");

    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    editor.value = "dirty again";
    confirm.mockReturnValue(false);
    click(root, "#file-quit");
    expect(close).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    click(root, "#file-quit");
    expect(close).toHaveBeenCalled();
    vi.runAllTimers();
    expect(root.querySelector("#file-status")?.textContent).toBe("The browser kept this page open.");
    vi.useRealTimers();
  });

  it("explains a flag from the letter and from its 0 or 1", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const carry = root.querySelector("[data-flag='c'][data-side='main']");
    expect(carry?.querySelector(".flag-name")?.textContent).toBe("C");
    expect(carry?.querySelector(".flag-state")?.textContent).toBe("0");
    expect(carry?.querySelector(".flag-bubble")?.textContent).toBe(
      "C, Carry. Set when an unsigned add or subtract does not fit, or when a shift or rotate pushes a bit out.",
    );
    expect(root.querySelectorAll(".flag-bubble")).toHaveLength(12);
  });

  it("spaces IX from IY, explains I and R, and shows a single cycle count", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    const ix = root.querySelector("[data-pair='ix']");
    const iy = root.querySelector("[data-pair='iy']");
    expect(ix?.querySelector("[data-key='ixh']")).not.toBeNull();
    expect(ix?.querySelector("[data-key='ixl']")).not.toBeNull();
    expect(ix?.querySelector("[data-key='iyh']")).toBeNull();
    expect(iy?.querySelector("[data-key='iyh']")).not.toBeNull();
    expect(iy?.querySelector("[data-key='iyl']")).not.toBeNull();
    expect(ix?.compareDocumentPosition(iy ?? ix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const interrupt = root.querySelector("[data-key='i']")?.closest(".reg");
    const refresh = root.querySelector("[data-key='r']")?.closest(".reg");
    expect(interrupt?.querySelector(".reg-name")?.textContent).toBe("I page");
    expect(interrupt?.querySelector(".reg-bubble")?.textContent).toBe(
      "I, Interrupt page. The high byte of the address used in interrupt mode 2. The device supplies the low byte.",
    );
    expect(refresh?.querySelector(".reg-name")?.textContent).toBe("R refresh");
    expect(refresh?.querySelector(".reg-bubble")?.textContent).toContain("Increments as instructions run");

    chooseExample(root, "sample");
    expect(root.querySelector("#next-instruction")?.textContent).toContain("LD SP,0XFF00");
    expect(root.querySelector("#next-instruction")?.textContent).not.toContain("cycles");
    expect(root.querySelector("#next-instruction")?.parentElement?.querySelector(".insn-cycles")?.textContent).toBe("cycles 10");
    click(root, "#step");
    expect(root.querySelector("#last-instruction")?.textContent).toContain("LD SP,0XFF00");
    expect(root.querySelector("#last-instruction")?.textContent).not.toContain("cycles");
    expect(root.querySelector("#last-instruction")?.parentElement?.querySelector(".insn-cycles")?.textContent).toBe("cycles 10");
    expect(root.querySelector("#next-instruction")?.textContent).toContain("LD IX,0X4000");
    expect(root.querySelector("#next-instruction")?.parentElement?.querySelector(".insn-cycles")?.textContent).toBe("cycles 14");

    const editor = editorValue(root);
    editor.value = "        ORG 0100H\n        DJNZ $\n        HALT\n";
    click(root, "#assemble");
    const next = root.querySelector("#next-instruction")?.textContent ?? "";
    expect(next).toContain("DJNZ");
    expect(next).not.toContain("cycles");
  });

  it("runs AND and INC without the toy animation", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    chooseExample(root, "logic");
    click(root, "#step");
    click(root, "#step");
    click(root, "#step");
    expect(root.querySelector("[data-key='main.a']")?.textContent).toBe("00");
    expect(document.querySelector(".logic-bit")).toBeNull();
    expect(document.querySelector(".counter-wheel")).toBeNull();
    expect(document.querySelector(".alu-bit")).toBeNull();
    expect(root.querySelector("#motion-speed")).toBeNull();
    expect(root.querySelector("#motion-pause")).toBeNull();
  });
});

describe("run, step back, edit, and the address box", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  function assemble(root: ParentNode, source: string): void {
    editorValue(root).value = source;
    click(root, "#assemble");
  }

  it("runs to a gutter line and Stop leaves the machine where it is", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    expect(root.querySelector("#step-back")?.textContent).toBe("Step back");
    expect(root.querySelector<HTMLButtonElement>("#step-back")?.disabled).toBe(true);
    assemble(root, "        NOP\nLOOP:   JR LOOP\n");
    const halt = root.querySelector(".gutter-row[role='button']");
    expect(halt?.getAttribute("title")).toBe("Run to this line");
    const rows = root.querySelectorAll(".gutter-row.runnable");
    expect(rows.length).toBeGreaterThan(1);
    rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(root.querySelector("#step")?.textContent).toBe("Stop");
    expect(root.querySelector("#status")?.textContent).toContain("Steps: 1");
    click(root, "#step");
    expect(root.querySelector("#step")?.textContent).toBe("Step");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(root.querySelector("#status")?.textContent).toContain("Steps: 1");
  });

  it("steps back one instruction and edits a register in the current format", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    assemble(root, "        LD B, A\n");
    const cell = root.querySelector("[data-key='main.a']");
    if (!(cell instanceof HTMLElement)) {
      throw new Error("missing A");
    }
    cell.click();
    const input = cell.querySelector("input");
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("missing editor");
    }
    input.value = "3C";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(root.querySelector("[data-key='main.a']")?.textContent).toBe("3C");
    click(root, "#step");
    expect(root.querySelector("[data-key='main.b']")?.textContent).toBe("3C");
    click(root, "#step-back");
    expect(root.querySelector("[data-key='main.a']")?.textContent).toBe("3C");
    expect(root.querySelector("[data-key='main.b']")?.textContent).toBe("00");
  });

  it("keeps a filled address box from following a later write", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mount(root);
    assemble(root, "        LD A, 1\n        LD (0C000H), A\n");
    const box = root.querySelector("#jump-address");
    if (!(box instanceof HTMLInputElement)) {
      throw new Error("missing address");
    }
    box.value = "0100H";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    click(root, "#jump-form button[type='submit']");
    click(root, "#step");
    click(root, "#step");
    expect(root.querySelector("#memory-focus-title")?.textContent).toContain("0100");
    expect(root.querySelector("#memory-focus-title")?.textContent).not.toContain("C000");
    box.value = "";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector("#memory-focus-title")?.textContent).toContain("C000");
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
