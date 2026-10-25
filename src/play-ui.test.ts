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
    document.querySelectorAll(".travel-token, .flying-badge").forEach((node) => node.remove());
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
});

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
