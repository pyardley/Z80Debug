import { hi, lo } from "z80-base";
import { disassembleAt } from "./disasm";
import {
  bytesPerRow,
  formatByte,
  formatNames,
  formatWord,
  loadFormat,
  parseAddress,
  saveFormat,
  type DisplayFormat,
} from "./format";
import { exampleById, EXAMPLES } from "./examples";
import {
  canOpenWithPicker,
  canSaveWithPicker,
  downloadText,
  fileFailure,
  isAbortError,
  isSecurityError,
  openWithPicker,
  readHandle,
  saveWithPicker,
  writeHandle,
} from "./files";
import { Machine, type RegisterBank } from "./machine";

const SOURCE_LINE_HEIGHT = 20;

const UNTITLED = "Untitled";

let detachChrome: (() => void) | undefined;

const FLAG_BITS: { key: string; label: string; mask: number }[] = [
  { key: "s", label: "S", mask: 0x80 },
  { key: "z", label: "Z", mask: 0x40 },
  { key: "h", label: "H", mask: 0x10 },
  { key: "pv", label: "P/V", mask: 0x04 },
  { key: "n", label: "N", mask: 0x02 },
  { key: "c", label: "C", mask: 0x01 },
];

function readDisplayFormat(): DisplayFormat {
  try {
    return loadFormat(window.localStorage);
  } catch {
    return "hex";
  }
}

function writeDisplayFormat(format: DisplayFormat): void {
  try {
    saveFormat(window.localStorage, format);
  } catch {
    // Safari throws when a file:// page touches localStorage. Keep drawing.
  }
}

export function mount(root: HTMLElement): void {
  const machine = new Machine();
  let format = readDisplayFormat();
  let lookAddress: number | undefined;
  let followWrite = true;

  const exampleOptions = EXAMPLES.map((example) => {
    const selected = example.id === "sample" ? " selected" : "";
    return `<option value="${example.id}"${selected}>${example.label}</option>`;
  }).join("");

  root.innerHTML = `
    <header class="toolbar">
      <div class="menu" id="file-menu-root">
        <button type="button" id="file-menu-button" aria-haspopup="menu" aria-expanded="false" aria-controls="file-menu">File</button>
        <div id="file-menu" class="menu-panel" role="menu" hidden>
          <button type="button" role="menuitem" id="file-new">New</button>
          <button type="button" role="menuitem" id="file-open" aria-keyshortcuts="Control+O Meta+O">Open… <span class="shortcut">Ctrl+O</span></button>
          <button type="button" role="menuitem" id="file-save" aria-keyshortcuts="Control+S Meta+S">Save <span class="shortcut">Ctrl+S</span></button>
          <button type="button" role="menuitem" id="file-save-as" aria-keyshortcuts="Control+Shift+S Meta+Shift+S">Save As… <span class="shortcut">Ctrl+Shift+S</span></button>
          <div class="menu-separator" role="separator"></div>
          <button type="button" role="menuitem" id="file-quit">Quit</button>
        </div>
      </div>
      <div class="title-block">
        <h1>Z80Debug</h1>
        <p>Assembler and single-step debugger</p>
      </div>
      <div class="controls">
        <button type="button" id="assemble">Assemble</button>
        <button type="button" id="reset">Reset</button>
        <button type="button" id="step">Step</button>
      </div>
      <div class="format" role="radiogroup" aria-label="Display format">
        <span class="format-label">Values</span>
        <button type="button" id="format-hex" role="radio">Hex</button>
        <button type="button" id="format-decimal" role="radio">Decimal</button>
        <button type="button" id="format-binary" role="radio">Binary</button>
        <button type="button" id="format-ascii" role="radio">ASCII</button>
      </div>
    </header>
    <p id="caption" class="caption">
      EX AF,AF' swaps only AF. EXX swaps BC, DE, and HL together and does not touch AF.
      Active is the bank instructions read and write. Shadow is the other bank.
    </p>
    <section class="console-pane" aria-label="Console">
      <div class="pane-head">
        <h2>Console</h2>
        <div class="controls">
          <p id="console-waiting" class="hint" role="status">Waiting: 0</p>
          <button type="button" id="console-clear">Clear</button>
        </div>
      </div>
      <div class="console-ports">
        <p><strong>00H data.</strong> OUT (00H),A appends A to the console. IN A,(00H) returns the next character you typed and removes it from the queue. If the queue is empty, IN returns 00H.</p>
        <p><strong>01H status.</strong> IN A,(01H) returns 0FFH when at least one character is queued, and 00H when the queue is empty. OUT to 01H is ignored.</p>
        <p>Every other port stays as it was: IN returns 0FFH and OUT is discarded. 0AH and 0DH start a new line, and a CR+LF pair is one new line. 08H deletes the last character on the current line. 09H is a tab to the next multiple of 8. 20H–7EH are the ASCII glyph. Any other byte is a middle dot.</p>
      </div>
      <pre id="console-output" class="console-screen" role="log" aria-live="polite"></pre>
      <form id="console-form" class="console-form">
        <label for="console-input">Type</label>
        <input id="console-input" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="Type a character, then Queue">
        <button type="submit">Queue</button>
      </form>
    </section>
    <div class="workspace">
      <section class="editor-pane">
        <div class="pane-head">
          <div class="source-title">
            <h2>Source</h2>
            <p id="loaded-name" class="loaded-name">sample.asm</p>
          </div>
          <span class="source-actions">
            <label class="example-label" for="examples">Examples</label>
            <select id="examples">
              <option value="">Examples</option>
              ${exampleOptions}
            </select>
            <button type="button" id="load-example">Load</button>
          </span>
        </div>
        <p id="file-status" class="file-status" role="status"></p>
        <p class="hint source-hint">Zilog mnemonics, case-insensitive. Comments start with ;</p>
        <div class="source-scroll" id="source-scroll">
          <div class="source-gutter-clip">
            <div class="source-gutter" id="source-gutter"></div>
          </div>
          <div class="source-code">
            <div class="source-highlights" id="source-highlights" aria-hidden="true"></div>
            <textarea id="editor" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="source-pointer"></textarea>
          </div>
        </div>
        <p id="source-pointer" class="source-pointer" role="status" aria-live="polite"></p>
        <div id="errors" class="errors" role="status"></div>
      </section>
      <section class="cpu-pane">
        <div id="status" class="status"></div>
        <div id="instruction" class="instruction"></div>
        <div id="system-regs"></div>
        <div id="banks" class="banks"></div>
      </section>
    </div>
    <section class="memory-pane">
      <div>
        <div class="pane-head"><h2>Memory around PC</h2></div>
        <div id="memory-pc" class="dump"></div>
      </div>
      <div>
        <div class="pane-head">
          <h2 id="memory-focus-title">Memory around latest write</h2>
          <form id="jump-form" class="jump">
            <label for="jump-address">Address</label>
            <input id="jump-address" type="text" spellcheck="false" autocomplete="off" placeholder="0C000H">
            <button type="submit">Show</button>
            <button type="button" id="show-write">Latest write</button>
          </form>
        </div>
        <div id="writes" class="writes"></div>
        <div id="memory-focus" class="dump"></div>
      </div>
    </section>
    <input id="file-input" type="file" accept=".asm,.z80,.s,.txt,text/plain" hidden>
  `;

  const editor = required<HTMLTextAreaElement>(root, "#editor");
  const starting = exampleById("sample");
  editor.value = starting?.source ?? "";
  let savedText = editor.value;
  let loadedName = starting?.filename ?? UNTITLED;
  let exampleId = starting?.id ?? "";
  let fileHandle: FileSystemFileHandle | undefined;
  let fileBusy = false;
  let markedLine: number | undefined;

  editor.addEventListener("scroll", () => {
    syncSourceScroll();
  });
  editor.addEventListener("input", () => {
    paintSource();
    paintDocument();
  });

  required<HTMLButtonElement>(root, "#assemble").addEventListener("click", () => {
    machine.assemble(editor.value);
    lookAddress = undefined;
    followWrite = true;
    render();
  });
  required<HTMLButtonElement>(root, "#reset").addEventListener("click", () => {
    machine.reset();
    lookAddress = undefined;
    followWrite = true;
    render();
  });
  required<HTMLButtonElement>(root, "#step").addEventListener("click", () => {
    machine.step();
    render();
  });
  required<HTMLButtonElement>(root, "#file-menu-button").addEventListener("click", () => {
    toggleMenu();
  });
  required<HTMLButtonElement>(root, "#file-new").addEventListener("click", () => {
    newFile();
  });
  required<HTMLButtonElement>(root, "#file-open").addEventListener("click", () => {
    void openFile();
  });
  required<HTMLButtonElement>(root, "#file-save").addEventListener("click", () => {
    void saveFile();
  });
  required<HTMLButtonElement>(root, "#file-save-as").addEventListener("click", () => {
    void saveFileAs();
  });
  required<HTMLButtonElement>(root, "#file-quit").addEventListener("click", () => {
    quit();
  });
  required<HTMLInputElement>(root, "#file-input").addEventListener("change", () => {
    void openedFromInput();
  });
  required<HTMLSelectElement>(root, "#examples").addEventListener("change", () => {
    const id = required<HTMLSelectElement>(root, "#examples").value;
    if (id === "") {
      paintDocument();
      return;
    }
    loadExample(id);
  });
  required<HTMLButtonElement>(root, "#load-example").addEventListener("click", () => {
    const id = required<HTMLSelectElement>(root, "#examples").value;
    if (id === "") {
      return;
    }
    loadExample(id);
  });
  required<HTMLButtonElement>(root, "#console-clear").addEventListener("click", () => {
    machine.clearConsole();
    render();
  });
  required<HTMLFormElement>(root, "#console-form").addEventListener("submit", (event) => {
    event.preventDefault();
    queueTyped();
  });

  for (const name of formatNames()) {
    required<HTMLButtonElement>(root, `#format-${name}`).addEventListener("click", () => {
      format = name;
      writeDisplayFormat(format);
      render();
    });
  }

  required<HTMLFormElement>(root, "#jump-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = required<HTMLInputElement>(root, "#jump-address");
    const address = parseAddress(input.value);
    const note = required<HTMLElement>(root, "#memory-focus-title");
    if (address === undefined) {
      note.textContent = "Address not recognised";
      return;
    }
    lookAddress = address;
    followWrite = false;
    render();
  });
  required<HTMLButtonElement>(root, "#show-write").addEventListener("click", () => {
    followWrite = true;
    lookAddress = undefined;
    render();
  });

  bindChrome(
    (event) => {
      if (event.key === "Escape") {
        closeMenu();
      }
      if (event.repeat || event.altKey || !(event.ctrlKey || event.metaKey)) {
        return;
      }
      if (event.code === "KeyS" && event.shiftKey) {
        event.preventDefault();
        void saveFileAs();
      } else if (event.code === "KeyS") {
        event.preventDefault();
        void saveFile();
      } else if (event.code === "KeyO" && !event.shiftKey) {
        event.preventDefault();
        void openFile();
      }
    },
    (event) => {
      const menu = required<HTMLElement>(root, "#file-menu-root");
      if (event.target instanceof Node && menu.contains(event.target)) {
        return;
      }
      closeMenu();
    },
  );

  render();

  function render(): void {
    root.classList.toggle("format-ascii", format === "ascii");
    paintFormat();
    paintStatus();
    paintInstruction();
    paintSystem();
    paintBanks();
    paintMemory();
    paintErrors();
    paintSource();
    paintConsole();
    paintDocument();
    markChanged(root, machine.changed);
    required<HTMLButtonElement>(root, "#step").disabled = !machine.ready || machine.halted;
  }

  function loadExample(id: string): void {
    const example = exampleById(id);
    if (example === undefined) {
      paintDocument();
      return;
    }
    if (!confirmDiscard()) {
      paintDocument();
      return;
    }
    replaceDocument(example.source, example.filename, undefined, example.id);
    setFileStatus(`Loaded ${example.filename}.`);
  }

  function newFile(): void {
    if (!confirmDiscard()) {
      return;
    }
    closeMenu();
    replaceDocument("", UNTITLED, undefined, "");
    setFileStatus("");
  }

  async function openFile(): Promise<void> {
    if (fileBusy || !confirmDiscard()) {
      return;
    }
    closeMenu();
    fileBusy = true;
    try {
      if (canOpenWithPicker()) {
        try {
          const handle = await openWithPicker();
          const opened = await readHandle(handle);
          replaceDocument(opened.text, opened.name, handle, "");
          setFileStatus(`Opened ${opened.name}.`);
          return;
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }
          if (!isSecurityError(error)) {
            setFileStatus(fileFailure(error));
            return;
          }
        }
      }
      required<HTMLInputElement>(root, "#file-input").click();
    } finally {
      fileBusy = false;
    }
  }

  async function openedFromInput(): Promise<void> {
    const input = required<HTMLInputElement>(root, "#file-input");
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) {
      return;
    }
    try {
      const text = await file.text();
      replaceDocument(text, file.name, undefined, "");
      setFileStatus(`Opened ${file.name}.`);
    } catch (error) {
      setFileStatus(fileFailure(error));
    }
  }

  async function saveFile(): Promise<void> {
    if (fileBusy) {
      return;
    }
    closeMenu();
    if (fileHandle === undefined) {
      await saveFileAs();
      return;
    }
    fileBusy = true;
    try {
      await writeHandle(fileHandle, editor.value);
      savedText = editor.value;
      setFileStatus(`Saved ${loadedName}.`);
      render();
    } catch (error) {
      if (!isAbortError(error)) {
        setFileStatus(fileFailure(error));
      }
    } finally {
      fileBusy = false;
    }
  }

  async function saveFileAs(): Promise<void> {
    if (fileBusy) {
      return;
    }
    closeMenu();
    const suggested = loadedName === UNTITLED ? "program.asm" : loadedName;
    fileBusy = true;
    try {
      if (canSaveWithPicker()) {
        try {
          const handle = await saveWithPicker(suggested);
          await writeHandle(handle, editor.value);
          fileHandle = handle;
          loadedName = handle.name;
          exampleId = "";
          savedText = editor.value;
          setFileStatus(`Saved ${handle.name}.`);
          render();
          return;
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }
          if (!isSecurityError(error)) {
            setFileStatus(fileFailure(error));
            return;
          }
        }
      }
      downloadText(suggested, editor.value);
      fileHandle = undefined;
      loadedName = suggested;
      exampleId = "";
      savedText = editor.value;
      setFileStatus(`Downloaded ${suggested}. This browser cannot write the file in place.`);
      render();
    } finally {
      fileBusy = false;
    }
  }

  function quit(): void {
    if (!confirmDiscard()) {
      return;
    }
    closeMenu();
    window.close();
    window.setTimeout(() => {
      setFileStatus("The browser kept this page open.");
    }, 0);
  }

  function replaceDocument(
    source: string,
    name: string,
    handle: FileSystemFileHandle | undefined,
    nextExample: string,
  ): void {
    editor.value = source;
    savedText = source;
    loadedName = name;
    fileHandle = handle;
    exampleId = nextExample;
    machine.assemble(source);
    lookAddress = undefined;
    followWrite = true;
    render();
  }

  function confirmDiscard(): boolean {
    if (editor.value === savedText) {
      return true;
    }
    return window.confirm(`Discard unsaved edits to ${loadedName}?`);
  }

  function paintDocument(): void {
    const name = required<HTMLElement>(root, "#loaded-name");
    name.textContent = editor.value === savedText ? loadedName : `${loadedName} (unsaved)`;
    const select = required<HTMLSelectElement>(root, "#examples");
    if (select.value !== exampleId) {
      select.value = exampleId;
    }
  }

  function setFileStatus(message: string): void {
    required<HTMLElement>(root, "#file-status").textContent = message;
  }

  function toggleMenu(): void {
    const panel = required<HTMLElement>(root, "#file-menu");
    const button = required<HTMLButtonElement>(root, "#file-menu-button");
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }

  function closeMenu(): void {
    required<HTMLElement>(root, "#file-menu").hidden = true;
    required<HTMLButtonElement>(root, "#file-menu-button").setAttribute("aria-expanded", "false");
  }

  function queueTyped(): void {
    const input = required<HTMLInputElement>(root, "#console-input");
    if (input.value === "") {
      return;
    }
    machine.console.enqueueText(input.value);
    input.value = "";
    render();
  }

  function paintConsole(): void {
    required<HTMLElement>(root, "#console-output").textContent = machine.console.text();
    const waiting = machine.console.waiting;
    const queued = machine.console.queuedGlyphs();
    required<HTMLElement>(root, "#console-waiting").textContent = queued === ""
      ? `Waiting: ${waiting}`
      : `Waiting: ${waiting} (${queued})`;
  }

  function paintFormat(): void {
    for (const name of formatNames()) {
      const button = required<HTMLButtonElement>(root, `#format-${name}`);
      const selected = format === name;
      button.setAttribute("aria-checked", selected ? "true" : "false");
      button.classList.toggle("selected", selected);
    }
  }

  function paintStatus(): void {
    const status = required<HTMLElement>(root, "#status");
    status.className = "status";
    if (!machine.ready) {
      status.textContent = machine.errors.length > 0
        ? "Assembly failed. Step stays disabled until assembly succeeds."
        : "Not assembled. Step stays disabled until assembly succeeds.";
      return;
    }
    const pc = formatWord(machine.cpu.regs.pc, format);
    const shown = formatStatusLabel(format);
    if (machine.halted) {
      status.classList.add("halted");
      status.textContent = `Halted at PC ${pc}. Step is stopped. Values shown in ${shown}.`;
      return;
    }
    status.textContent = `Ready at PC ${pc}. Step runs one instruction. Values shown in ${shown}. Steps: ${machine.steps}.`;
  }

  function paintInstruction(): void {
    const box = required<HTMLElement>(root, "#instruction");
    box.replaceChildren();
    const current = disassembleAt(machine.memory, machine.cpu.regs.pc);
    box.append(line("Next", `${current.text}    bytes ${formatBytes(current.bytes)}`));
    if (machine.lastInstruction) {
      box.append(line("Last", machine.lastInstruction));
    }
  }

  function paintSystem(): void {
    const host = required<HTMLElement>(root, "#system-regs");
    host.replaceChildren();
    const regs = machine.cpu.regs;
    const grid = document.createElement("div");
    grid.className = "system-regs";
    grid.append(
      regCell("PC", formatWord(regs.pc, format), "pc", true),
      regCell("SP", formatWord(regs.sp, format), "sp", true),
      regCell("IX", formatWord(regs.ix, format), "ix", true),
      regCell("IY", formatWord(regs.iy, format), "iy", true),
      regCell("I", formatByte(regs.i, format), "i", false),
      regCell("R", formatByte(machine.refreshRegister(), format), "r", false),
    );
    host.append(grid);
  }

  function paintBanks(): void {
    const host = required<HTMLElement>(root, "#banks");
    host.replaceChildren();
    const banks = machine.banks();
    host.append(bankColumn("Main", "main", banks.main), bankColumn("Alternate", "alt", banks.alternate));
  }

  function bankColumn(title: string, prefix: "main" | "alt", bank: RegisterBank): HTMLElement {
    const column = document.createElement("section");
    column.className = "bank";
    const heading = document.createElement("h2");
    heading.textContent = `${title} bank`;
    column.append(heading);
    column.append(pairBlock(
      prefix === "main" ? "AF" : "AF'",
      `${prefix}.af`,
      bank.afActive ? "Active" : "Shadow",
      `badge.${prefix}.af`,
      [
        ["A", hi(bank.af), false],
        ["F", lo(bank.af), false],
        [prefix === "main" ? "AF" : "AF'", bank.af, true],
      ],
      prefix,
      bank.af,
    ));
    column.append(flagRow(prefix, lo(bank.af)));
    column.append(pairBlock(
      prefix === "main" ? "BC DE HL" : "BC' DE' HL'",
      `${prefix}.exx`,
      bank.exxActive ? "Active" : "Shadow",
      `badge.${prefix}.exx`,
      [],
      prefix,
      0,
    ));
    const exx = column.lastElementChild as HTMLElement;
    exx.append(
      byteLine(prefix, [
        ["B", hi(bank.bc), `${prefix}.b`],
        ["C", lo(bank.bc), `${prefix}.c`],
        [prefix === "main" ? "BC" : "BC'", bank.bc, `${prefix}.bc`],
      ]),
      byteLine(prefix, [
        ["D", hi(bank.de), `${prefix}.d`],
        ["E", lo(bank.de), `${prefix}.e`],
        [prefix === "main" ? "DE" : "DE'", bank.de, `${prefix}.de`],
      ]),
      byteLine(prefix, [
        ["H", hi(bank.hl), `${prefix}.h`],
        ["L", lo(bank.hl), `${prefix}.l`],
        [prefix === "main" ? "HL" : "HL'", bank.hl, `${prefix}.hl`],
      ]),
    );
    return column;
  }

  function pairBlock(
    title: string,
    _groupKey: string,
    state: "Active" | "Shadow",
    badgeKey: string,
    cells: [string, number, boolean][],
    prefix: string,
    af: number,
  ): HTMLElement {
    const block = document.createElement("div");
    block.className = "reg-group";
    const head = document.createElement("div");
    head.className = "group-head";
    const name = document.createElement("h3");
    name.textContent = title;
    const badge = document.createElement("span");
    badge.className = `badge ${state === "Active" ? "active" : "shadow"}`;
    badge.id = badgeKey.replace(/\./g, "-");
    badge.textContent = state;
    badge.dataset.state = state;
    if (machine.changed.has(badgeKey)) {
      badge.classList.add("changed");
    }
    head.append(name, badge);
    block.append(head);
    if (cells.length > 0) {
      const row = document.createElement("div");
      row.className = "reg-row";
      for (const [label, value, wide] of cells) {
        const key = label.startsWith("AF") ? `${prefix}.af` : label === "A" ? `${prefix}.a` : `${prefix}.f`;
        row.append(regCell(label, wide ? formatWord(value, format) : formatByte(value, format), key, wide));
      }
      block.append(row);
      void af;
    }
    return block;
  }

  function byteLine(prefix: string, cells: [string, number, string][]): HTMLElement {
    const row = document.createElement("div");
    row.className = "reg-row";
    for (const [label, value, key] of cells) {
      const wide = key.endsWith(".bc") || key.endsWith(".de") || key.endsWith(".hl");
      row.append(regCell(label, wide ? formatWord(value, format) : formatByte(value, format), key, wide));
    }
    void prefix;
    return row;
  }

  function flagRow(prefix: string, flags: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "flags";
    const caption = document.createElement("span");
    caption.className = "flag-caption";
    caption.textContent = "Flags";
    row.append(caption);
    for (const flag of FLAG_BITS) {
      const bit = document.createElement("span");
      bit.className = "flag";
      bit.textContent = flag.label;
      bit.dataset.set = (flags & flag.mask) !== 0 ? "1" : "0";
      if ((flags & flag.mask) !== 0) {
        bit.classList.add("set");
      }
      if (machine.changed.has(`${prefix}.flag.${flag.key}`)) {
        bit.classList.add("changed");
      }
      row.append(bit);
    }
    return row;
  }

  function paintMemory(): void {
    const pc = machine.cpu.regs.pc & 0xffff;
    paintDump(required<HTMLElement>(root, "#memory-pc"), pc, true);
    const focusTitle = required<HTMLElement>(root, "#memory-focus-title");
    let focus = 0;
    if (!followWrite && lookAddress !== undefined) {
      focus = lookAddress;
      focusTitle.textContent = `Memory at ${formatWord(focus, format)}`;
    } else if (machine.lastWriteAddress !== undefined) {
      focus = machine.lastWriteAddress;
      focusTitle.textContent = `Memory around latest write ${formatWord(focus, format)}`;
    } else {
      focusTitle.textContent = "Memory around latest write";
    }
    paintDump(required<HTMLElement>(root, "#memory-focus"), focus, false);
    const writes = required<HTMLElement>(root, "#writes");
    writes.replaceChildren();
    if (machine.writes.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = machine.lastWriteAddress === undefined
        ? "No memory write yet."
        : "Last instruction did not write memory.";
      writes.append(empty);
      return;
    }
    for (const write of machine.writes) {
      const item = document.createElement("p");
      item.className = "write";
      item.textContent = `Wrote ${formatWord(write.address, format)}  ${formatByte(write.previous, format)} → ${formatByte(write.value, format)}`;
      writes.append(item);
    }
  }

  function paintDump(host: HTMLElement, center: number, markPc: boolean): void {
    host.replaceChildren();
    const width = bytesPerRow(format);
    const rows = 4;
    const aligned = center & ~(width - 1);
    let start = (aligned - width) & 0xffff;
    const written = new Set(machine.writes.map((write) => write.address));
    const pc = machine.cpu.regs.pc & 0xffff;
    for (let row = 0; row < rows; row++) {
      const address = (start + row * width) & 0xffff;
      const line = document.createElement("div");
      line.className = "dump-row";
      const addr = document.createElement("span");
      addr.className = "num addr";
      const containsPc = markPc && address <= pc && pc < address + width;
      addr.textContent = `${containsPc ? "PC " : "   "}${formatWord(address, format)}`;
      line.append(addr);
      const bytes = document.createElement("span");
      bytes.className = "bytes";
      let ascii = "";
      const showSidebar = format !== "ascii";
      for (let offset = 0; offset < width; offset++) {
        const location = (address + offset) & 0xffff;
        const value = machine.memory[location];
        const cell = document.createElement("span");
        cell.className = "num mem-byte";
        cell.textContent = formatByte(value, format);
        if (written.has(location)) {
          cell.classList.add("changed");
        }
        if (markPc && location === pc) {
          cell.classList.add("pc-byte");
          cell.title = "PC";
        }
        bytes.append(cell);
        if (showSidebar) {
          ascii += value >= 32 && value < 127 ? String.fromCharCode(value) : ".";
        }
      }
      line.append(bytes);
      if (showSidebar) {
        const text = document.createElement("span");
        text.className = "ascii";
        text.textContent = ascii;
        line.append(text);
      }
      host.append(line);
    }
  }

  function paintSource(): void {
    const sourceLines = editor.value.split("\n");
    const count = Math.max(sourceLines.length, 1);
    const pc = machine.cpu.regs.pc & 0xffff;
    const line = machine.ready ? machine.sourceLine(pc) : undefined;
    const gutter = required<HTMLElement>(root, "#source-gutter");
    const highlights = required<HTMLElement>(root, "#source-highlights");
    gutter.replaceChildren();
    highlights.replaceChildren();
    for (let index = 0; index < count; index++) {
      const number = index + 1;
      const current = line === number;
      gutter.append(gutterRow(number, current));
      const bar = document.createElement("div");
      bar.className = current ? "highlight-row current" : "highlight-row";
      highlights.append(bar);
    }

    const pointer = required<HTMLElement>(root, "#source-pointer");
    pointer.classList.toggle("outside", machine.ready && line === undefined);
    if (line !== undefined) {
      pointer.textContent = currentLineLabel(line);
    } else if (machine.ready) {
      pointer.textContent = `Address ${formatWord(pc, format).trim()} is not in the source.`;
    } else {
      pointer.textContent = "";
    }

    const shell = required<HTMLElement>(root, "#source-scroll");
    if (line === undefined) {
      delete shell.dataset.currentLine;
    } else {
      shell.dataset.currentLine = String(line);
    }

    if (line !== markedLine) {
      markedLine = line;
      if (line !== undefined) {
        revealSourceLine(line);
      }
    }
    syncSourceScroll();
  }

  function currentLineLabel(line: number): string {
    const text = editor.value.split("\n")[line - 1]?.trim() ?? "";
    const snippet = text.length > 80 ? `${text.slice(0, 77)}...` : text;
    return snippet === "" ? `Current instruction, line ${line}.` : `Current instruction, line ${line}: ${snippet}.`;
  }

  function gutterRow(line: number, current: boolean): HTMLElement {
    const row = document.createElement("div");
    row.className = current ? "gutter-row current" : "gutter-row";
    const marker = document.createElement("span");
    marker.className = "pc-marker";
    if (current) {
      marker.textContent = "▶";
      marker.setAttribute("role", "img");
      marker.setAttribute("aria-current", "location");
      marker.setAttribute("aria-label", currentLineLabel(line));
    } else {
      marker.setAttribute("aria-hidden", "true");
    }
    const number = document.createElement("span");
    number.className = "line-no";
    number.textContent = String(line);
    number.setAttribute("aria-hidden", "true");
    row.append(marker, number);
    return row;
  }

  function revealSourceLine(line: number): void {
    const top = (line - 1) * SOURCE_LINE_HEIGHT;
    const bottom = top + SOURCE_LINE_HEIGHT;
    const viewTop = editor.scrollTop;
    const viewBottom = viewTop + editor.clientHeight;
    if (top < viewTop || bottom > viewBottom) {
      const room = Math.max(0, editor.clientHeight - SOURCE_LINE_HEIGHT);
      editor.scrollTop = Math.max(0, top - room / 2);
    }
  }

  function syncSourceScroll(): void {
    const offset = `translateY(${-editor.scrollTop}px)`;
    required<HTMLElement>(root, "#source-gutter").style.transform = offset;
    required<HTMLElement>(root, "#source-highlights").style.transform = offset;
  }

  function paintErrors(): void {
    const host = required<HTMLElement>(root, "#errors");
    host.replaceChildren();
    if (machine.errors.length === 0) {
      return;
    }
    const title = document.createElement("h2");
    title.textContent = "Assembly errors";
    host.append(title);
    const list = document.createElement("ul");
    for (const error of machine.errors) {
      const item = document.createElement("li");
      item.textContent = `Line ${error.line}: ${error.message}`;
      list.append(item);
    }
    host.append(list);
  }

  function formatBytes(bytes: number[]): string {
    return bytes.map((byte) => formatByte(byte, format)).join(" ");
  }
}

function formatStatusLabel(format: DisplayFormat): string {
  switch (format) {
    case "hex":
      return "hexadecimal";
    case "decimal":
      return "decimal";
    case "binary":
      return "binary";
    case "ascii":
      return "ASCII";
  }
}

function regCell(label: string, text: string, key: string, wide: boolean): HTMLElement {
  const cell = document.createElement("span");
  cell.className = "reg";
  const name = document.createElement("span");
  name.className = "reg-name";
  name.textContent = label;
  const value = document.createElement("span");
  value.className = `num ${wide ? "word" : "byte"}`;
  value.textContent = text;
  value.dataset.key = key;
  cell.append(name, value);
  return cell;
}

function line(label: string, text: string): HTMLElement {
  const row = document.createElement("p");
  const name = document.createElement("span");
  name.className = "insn-label";
  name.textContent = label;
  const value = document.createElement("span");
  value.className = "num";
  value.id = label === "Last" ? "last-instruction" : "next-instruction";
  value.textContent = text;
  row.append(name, value);
  return row;
}

function bindChrome(
  onKey: (event: KeyboardEvent) => void,
  onPointer: (event: MouseEvent) => void,
): void {
  detachChrome?.();
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onPointer);
  detachChrome = () => {
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onPointer);
  };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector(selector);
  if (!element) {
    throw new Error(`Missing ${selector}`);
  }
  return element as T;
}

export function markChanged(root: ParentNode, changed: ReadonlySet<string>): void {
  root.querySelectorAll<HTMLElement>("[data-key]").forEach((element) => {
    const key = element.dataset.key;
    element.classList.toggle("changed", key !== undefined && changed.has(key));
  });
}
