import { Disasm, Instruction } from "z80-disasm";

const disasm = new Disasm();

export interface DisassembledInstruction {
  text: string;
  bytes: number[];
}

export function disassembleAt(memory: Uint8Array, address: number): DisassembledInstruction {
  const pc = address & 0xffff;
  let instruction: Instruction;
  try {
    instruction = disasm.disassembleTrace(pc, (location) => memory[location & 0xffff] ?? 0);
  } catch {
    return { text: "??", bytes: [memory[pc] ?? 0] };
  }
  return {
    text: presentMnemonic(instruction.toText()),
    bytes: instruction.bin.map((byte) => byte & 0xff),
  };
}

function presentMnemonic(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => word.toUpperCase());
}
