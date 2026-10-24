import { Asm } from "z80-asm";
import { isReservedWord } from "./mnemonics";

export interface AssembleError {
  line: number;
  message: string;
}

export interface AssembledProgram {
  ok: true;
  origin: number;
  image: Uint8Array;
}

export interface AssembleFailure {
  ok: false;
  errors: AssembleError[];
}

export type AssembleResult = AssembledProgram | AssembleFailure;

const MEMORY_SIZE = 0x10000;

export function assemble(source: string): AssembleResult {
  const lines = preprocess(source);
  let sourceFile;
  try {
    const asm = new Asm(() => lines);
    sourceFile = asm.assembleFile("program.asm");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [{ line: 1, message }] };
  }
  if (sourceFile === undefined) {
    return { ok: false, errors: [{ line: 1, message: "assembler could not read the source" }] };
  }

  const errors: AssembleError[] = [];
  const image = new Uint8Array(MEMORY_SIZE);
  let origin: number | undefined;

  for (const assembled of sourceFile.assembledLines) {
    if (assembled.error !== undefined) {
      const line = (assembled.lineNumber ?? 0) + 1;
      errors.push({ line, message: assembled.error });
    }
    if (assembled.binary.length > 0 && origin === undefined) {
      origin = assembled.address & 0xffff;
    }
    for (let index = 0; index < assembled.binary.length; index++) {
      const address = (assembled.address + index) & 0xffff;
      image[address] = assembled.binary[index] & 0xff;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, origin: origin ?? 0, image };
}

export function preprocess(source: string): string[] {
  return source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map(preprocessLine);
}

function preprocessLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith(";")) {
    return line;
  }
  if (/^[A-Za-z_.][\w.]*\s*::?/.test(trimmed)) {
    return trimmed;
  }
  const equ = trimmed.match(/^([A-Za-z_.][\w.]*)\s+(?:equ|defl)\b/i);
  if (equ && !isReservedWord(equ[1])) {
    return trimmed;
  }
  const assign = trimmed.match(/^([A-Za-z_.][\w.]*)\s*=/);
  if (assign && !isReservedWord(assign[1])) {
    return trimmed;
  }
  const labeled = trimmed.match(/^([A-Za-z_.][\w.]*)\s+([A-Za-z_.][\w.]*)\b/);
  if (labeled && !isReservedWord(labeled[1]) && isReservedWord(labeled[2])) {
    return trimmed;
  }
  return /^\s/.test(line) ? line : ` ${line}`;
}
