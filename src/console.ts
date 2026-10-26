import { asciiGlyph } from "./format";

/** Data port. OUT appends a byte. IN returns the next queued key, or 00H. */
export const CONSOLE_DATA_PORT = 0x00;

/** Status port. IN is 0FFH when a key is waiting, otherwise 00H. OUT is ignored. */
export const CONSOLE_STATUS_PORT = 0x01;

const CR = 0x0d;
const LF = 0x0a;
const BS = 0x08;
const TAB = 0x09;

/**
 * Console attached to ports 00H and 01H.
 * IN A,(n) and OUT (n),A put A in the high byte of the port address, so only
 * the low byte selects the port.
 */
export class ConsoleDevice {
  private readonly output: number[] = [];
  private readonly input: number[] = [];

  write(address: number, value: number): void {
    if ((address & 0xff) !== CONSOLE_DATA_PORT) {
      return;
    }
    this.output.push(value & 0xff);
  }

  read(address: number): number {
    const port = address & 0xff;
    if (port === CONSOLE_DATA_PORT) {
      return this.input.shift() ?? 0x00;
    }
    if (port === CONSOLE_STATUS_PORT) {
      return this.input.length > 0 ? 0xff : 0x00;
    }
    return 0xff;
  }

  enqueue(value: number): void {
    this.input.push(value & 0xff);
  }

  enqueueText(text: string): void {
    for (const character of text) {
      const code = character.codePointAt(0);
      if (code !== undefined && code <= 0xff) {
        this.input.push(code);
      }
    }
  }

  clear(): void {
    this.output.length = 0;
    this.input.length = 0;
  }

  capture(): { output: number[]; input: number[] } {
    return { output: this.output.slice(), input: this.input.slice() };
  }

  restore(state: { output: number[]; input: number[] }): void {
    this.output.length = 0;
    this.output.push(...state.output);
    this.input.length = 0;
    this.input.push(...state.input);
  }

  get waiting(): number {
    return this.input.length;
  }

  get bytes(): readonly number[] {
    return this.output;
  }

  queuedGlyphs(): string {
    return this.input.map((byte) => asciiGlyph(byte)).join("");
  }

  text(): string {
    return renderConsole(this.output);
  }
}

export function renderConsole(bytes: readonly number[]): string {
  const lines: string[] = [""];
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index] & 0xff;
    if (byte === CR || byte === LF) {
      if (byte === CR && index + 1 < bytes.length && (bytes[index + 1] & 0xff) === LF) {
        index += 1;
      }
      lines.push("");
      continue;
    }
    const line = lines[lines.length - 1];
    if (byte === BS) {
      lines[lines.length - 1] = line.slice(0, -1);
      continue;
    }
    if (byte === TAB) {
      const spaces = 8 - (line.length % 8);
      lines[lines.length - 1] = line + " ".repeat(spaces);
      continue;
    }
    lines[lines.length - 1] = line + asciiGlyph(byte);
  }
  return lines.join("\n");
}
