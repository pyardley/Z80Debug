const MNEMONICS = [
  "nop", "ld", "inc", "dec", "rlca", "ex", "add", "rrca", "djnz", "rla", "jr", "rra",
  "daa", "cpl", "scf", "ccf", "halt", "adc", "sub", "sbc", "and", "xor", "or", "cp",
  "ret", "pop", "jp", "call", "push", "rst", "rlc", "rrc", "rl", "rr", "sla", "sra",
  "sll", "srl", "bit", "res", "set", "out", "exx", "in", "neg", "retn", "im", "reti",
  "rrd", "rld", "ldi", "cpi", "ini", "outi", "ldd", "cpd", "ind", "outd", "ldir",
  "cpir", "inir", "otir", "lddr", "cpdr", "indr", "otdr", "di", "ei",
];

const DIRECTIVES = [
  "org", ".org", ".loc",
  "equ", ".equ", "defl",
  "db", "defb", ".db", ".byte", "defm", "dm", ".dm", ".text", ".ascii", ".asciz",
  "dw", "defw", ".dw", ".word",
  "ds", "defs", ".ds", ".block", ".blkb", "data",
  "align", ".align",
  "macro", ".macro", "endm", ".endm",
  "if", "cond", "else", "endif", "endc",
  "end",
  ".long",
];

const RESERVED = new Set([...MNEMONICS, ...DIRECTIVES]);

export function isReservedWord(word: string): boolean {
  return RESERVED.has(word.toLowerCase());
}
