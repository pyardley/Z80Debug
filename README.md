# Z80Debug

A single-page Z80 assembler and single-step debugger. Write Zilog assembly, assemble it into a flat 64K memory image, and step one instruction at a time. Registers, flags, and memory update as the code runs. Number format switches between hexadecimal, decimal, and binary without changing machine state.

## Run

```sh
npm install
npm run dev
```

Open the URL Vite prints, usually http://localhost:5173. The editor starts with a short sample. Click **Assemble**, then **Step**.

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

**Hex**, **Decimal**, and **Binary** change only how values are drawn. The choice is stored in `localStorage` under `z80debug.displayFormat`.

- Bytes are 2 hex digits, 3 decimal columns, or 8 binary bits.
- Words and addresses are 4 hex digits, 5 decimal columns, or 16 binary bits.
- Hex and binary are padded with leading zeros. Decimal is padded with spaces.
- Flag letters stay letters. Numeric F follows the selected format.
- A memory row shows 16 bytes in hex, 8 in decimal, and 4 in binary.
- The disassembly mnemonic stays in hexadecimal. The bytes beside it follow the selected format, as do registers, F, memory, and addresses.

After each step, only the registers, flag bits, bank labels, and memory bytes that just changed are marked. The mark is replaced on the next step. A write also shows the old value and the new value.

**Step** runs one whole instruction, not one T-state. If the CPU executes `HALT`, the status line says so and **Step** stops.

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
- `IN` reads `FF`. `OUT` is discarded. There are no peripherals.
- `HALT` stops the stepper. No interrupt is wired up to leave the halt.
- R is this emulator's refresh counter. It increments all 8 bits on each opcode fetch. A silicon Z80 increments only the low 7 bits and leaves bit 7 alone except for `LD R,A`.
- Register names (`A`, `BC`, `HL`, and the rest) cannot be labels.
- Indexed instructions, relative jumps, and the block instructions (`LDIR`, `CPIR`, and the others) step as one instruction each.
