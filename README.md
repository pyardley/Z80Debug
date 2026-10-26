# Z80Debug

A single-page Z80 assembler and single-step debugger. Write Zilog assembly, assemble it into a flat 64K memory image, and step one instruction at a time. Registers, flags, memory, and the console update as the code runs. Number format switches between hexadecimal, decimal, binary, and ASCII without changing machine state.

## Run

```sh
npm install
npm run dev
```

Open the URL Vite prints, usually http://localhost:5173. The editor starts on `sample.asm`. Click **Assemble**, then **Step**. **Examples** loads another short program and replaces the editor. **Load** brings the selected program back after an edit. The programs live in `examples/`: the original sample, the console example, a console echo, flags, memory stores, register exchange, the stack, shifts and rotates, bit tests, logical operations, and a byte table.

**File** works on a source file from this computer. **New** clears the editor. **Open** reads a local `.asm` or other text file. In Chrome, a later **Save** writes that same file. If the file picker is missing, Open uses a normal file input and Save downloads a copy. **Save As** picks a new file, or downloads one. **Quit** calls `window.close()`. If the browser keeps the page open, the page says so. New, Open, an example, and Quit ask before discarding unsaved edits.

Ctrl+O or Cmd+O opens. Ctrl+S or Cmd+S saves. Ctrl+Shift+S or Cmd+Shift+S is Save As.

`z80debug.html` in the repository root is that same page as one file: the stylesheet in a `<style>` block and the app as one classic script. Download it and open it. Nothing else is fetched.

Memory around PC, memory around the latest write, and the stack sit in a column on the right. The stack grows downward. Each row is one word, high byte then low byte, and the row marked SP is the top. A push labels that word with the pair name. A call labels it return. A pop shows where the word went, such as BC → DE, and the note stays until those bytes are overwritten.

`z80debug-play.html` is the same machine on a tabletop toy computer. A chip carries a register load, a memory transfer, an immediate from the source line, or a stack word with its pair name. PUSH and CALL slide the SP marker down. POP and RET slide it back up. `EX AF,AF'` and `EXX` slide the Active and Shadow tags separately. A shift or rotate pops that byte into eight bits, slides them the way the instruction does, and carries the leaving bit into Carry. SET and RES pop the same bits and flip the chosen one. BIT highlights that bit and shows Z becoming its opposite. AND, OR, and XOR pop both bytes into eight bits, combine each column, and put the result back in the format that was already selected. INC and DEC roll those digits like a counter: up for INC, down for DEC. Hex wheels run 0–9 then A–F, decimal wheels run 0–9, and binary wheels run 0–1. ASCII rolls the byte as two hex wheels. A wheel that passes its last digit steps the next one, so 0F becomes 10 and 00FF becomes 0100. The cell then shows the result in the format that was already selected. `(HL)` and `(IX+d)` / `(IY+d)` pop the memory byte. **Motion** turns that animation off. The numbers update either way. **Speed**, beside Motion, runs every animation from a quarter of the pace to twice it. 1× is the pace the page opens with. The choice is stored in `localStorage` under `z80debug.animationSpeed`. If storage throws, the page stays at 1×. Hovering a flag, or the 0 or 1 beside it, explains that flag on both pages. The plain page runs the same instructions with no shift, bit, logic, or counter animation.

```sh
npm run build:html
```

That regenerates `z80debug.html` and `z80debug-play.html` after a source change. It needs the packages from `npm install`.

```sh
npm test
npm run build
npm run preview
```

## Reset state

Before a program assembles, memory and every register are zero and **Step** is disabled.

**Assemble** builds the source and resets the machine:

- PC is the origin: the address of the first assembled byte, or the address given to `END` when that directive is used.
- SP, IX, IY, I, R, AF, BC, DE, HL, and the alternate set are zero.
- The main AF bank and the main BC/DE/HL bank are **Active**. The alternate banks are **Shadow**.
- IFF1 and IFF2 are clear and the interrupt mode is 0. Those are not drawn; nothing in the UI raises an interrupt.
- Memory is the assembled image. Every other byte is 0.

**Reset** reloads that image and the same register state. It does not re-read the editor. A failed assemble leaves the previous machine alone and disables **Step** until assembly succeeds.

`EX AF,AF'` swaps only AF. `EXX` swaps BC, DE, and HL together and does not touch AF. **Active** is the bank ordinary instructions read and write. **Shadow** is the other bank. The two exchanges are independent, so the labels move separately.

## Display format

**Hex**, **Decimal**, **Binary**, and **ASCII** change only how values are drawn. The choice is stored in `localStorage` under `z80debug.displayFormat`. If the browser refuses storage, the page still opens in hexadecimal. A later choice applies for that visit and is not stored.

- Bytes are 2 hex digits, 3 decimal columns, 8 binary bits, or one ASCII character.
- Words and addresses are 4 hex digits, 5 decimal columns, 16 binary bits, or two ASCII characters (high byte, then low byte).
- Hex and binary are padded with leading zeros. Decimal is padded with spaces.
- ASCII shows the glyph for bytes `0x20`–`0x7E`. Every other byte is a middle dot (`·`), so a byte is always one column and a word is always two. `0x4142` is `AB`. `0x0100` is `··`.
- Flag letters stay letters. Numeric F follows the selected format.
- A memory row shows 16 bytes in hex and ASCII, 8 in decimal, and 4 in binary.
- In ASCII mode the value columns are the characters, so the separate ASCII sidebar is hidden. The sidebar stays for the other formats.
- The disassembly mnemonic stays in hexadecimal. The bytes beside it follow the selected format, as do registers, F, memory, and addresses.

After each step, only the registers, flag bits, bank labels, and memory bytes that just changed are marked. The mark is replaced on the next step. A write also shows the old value and the new value.

**Step** runs one whole instruction, not one T-state. If the CPU executes `HALT`, the status line says so and **Step** stops.

## Console

Ports `00H` and `01H` are a console. The same rules are written on the console panel. The port number is the low byte of the port address, which is what `IN A,(n)` and `OUT (n),A` select.

| Port | `IN` | `OUT` |
| --- | --- | --- |
| `00H` data | Next typed character, then removed from the queue. `00H` if the queue is empty. | Appends A. |
| `01H` status | `0FFH` when a character is waiting, otherwise `00H`. | Ignored. |
| Any other | `0FFH` | Discarded. |

Type into the console field. Each character waits in the queue until `IN A,(00H)` reads it. The panel shows how many characters are waiting.

`0AH` and `0DH` start a new line. A CR+LF pair is one new line. `08H` deletes the last character on the current line. `09H` is a tab, shown as spaces to the next multiple of 8. Bytes `20H`–`7EH` are the ASCII glyph. Any other byte is a middle dot. Drawing the console does not change machine state.

**Clear** and **Reset** empty the screen and the queue. **Assemble** resets the machine, so it clears the console as well. A failed assemble leaves the console alone.

## Syntax

Mnemonics and the directives below are case-insensitive. A comment runs from `;` to the end of the line. A label may sit in the first column, with or without a colon (`loop:` or `loop NOP`). `NAME EQU value` and `NAME = value` define constants.

| Directive | Role |
| --- | --- |
| `ORG` | Set the address of the next byte. `.ORG` and `.LOC` too. |
| `EQU`, `DEFL`, `=` | Define a constant. The name is required. |
| `DB`, `DEFB` | Emit bytes. Quoted strings are allowed. |
| `DW`, `DEFW` | Emit 16-bit words, low byte first. |
| `DS`, `DEFS` | Reserve bytes. `DS n, fill` also stores the fill byte. |

Numbers may be decimal (`255`), hex (`0xFF`, `$FF`, `0FFH`), or binary (`0b11111111`, `%11111111`, `11111111B`). A hex number that starts with a letter needs a leading zero: `0C3H`, not `C3H`.

The assembler also accepts its own `ALIGN`, `MACRO` / `ENDM`, `IF` / `ELSE` / `ENDIF`, and `END`. `#include` and binary inserts are not available here; the page has no filesystem.

## Cores

Execution uses Lawrence Kesteloot's MIT-licensed Z80 libraries from [trs80](https://github.com/lkesteloot/trs80):

- [z80-emulator](https://github.com/lkesteloot/trs80/tree/master/packages/z80-emulator) 2.3.0 executes one instruction per step.
- [z80-asm](https://github.com/lkesteloot/trs80/tree/master/packages/z80-asm) 2.3.0 assembles the source.
- [z80-disasm](https://github.com/lkesteloot/trs80/tree/master/packages/z80-disasm) 2.2.3 disassembles the instruction at PC.
- [z80-base](https://github.com/lkesteloot/trs80/tree/master/packages/z80-base) 2.0.1 supplies the register file those packages share.

See [THIRD-PARTY.md](THIRD-PARTY.md) for versions, URLs, and licenses.

## Limits

- The documented Z80 instruction set is supported. These cores also assemble and execute some undocumented opcodes, including `SLL`. An undefined `CB`, `DD`, `ED`, or `FD` opcode is consumed and not executed.
- Ports other than the console (`00H` data, `01H` status) still read `FF` and discard `OUT`.
- `HALT` stops the stepper. No interrupt is wired up to leave the halt.
- R is this emulator's refresh counter. It increments all 8 bits on each opcode fetch. A silicon Z80 increments only the low 7 bits and leaves bit 7 alone except for `LD R,A`.
- Register names (`A`, `BC`, `HL`, and the rest) cannot be labels.
- Indexed instructions, relative jumps, and the block instructions (`LDIR`, `CPIR`, and the others) step as one instruction each.
