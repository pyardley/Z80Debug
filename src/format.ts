export type DisplayFormat = "hex" | "decimal" | "binary" | "ascii";

export const FORMAT_STORAGE_KEY = "z80debug.displayFormat";

export const ASCII_MIDDLE_DOT = "\u00B7";

const FORMATS: readonly DisplayFormat[] = ["hex", "decimal", "binary", "ascii"];

export function isDisplayFormat(value: string | null): value is DisplayFormat {
  return value === "hex" || value === "decimal" || value === "binary" || value === "ascii";
}

export function formatByte(value: number, format: DisplayFormat): string {
  const byte = value & 0xff;
  switch (format) {
    case "hex":
      return byte.toString(16).toUpperCase().padStart(2, "0");
    case "decimal":
      return byte.toString(10).padStart(3, " ");
    case "binary":
      return byte.toString(2).padStart(8, "0");
    case "ascii":
      return formatAsciiByte(byte);
  }
}

export function formatWord(value: number, format: DisplayFormat): string {
  const word = value & 0xffff;
  switch (format) {
    case "hex":
      return word.toString(16).toUpperCase().padStart(4, "0");
    case "decimal":
      return word.toString(10).padStart(5, " ");
    case "binary":
      return word.toString(2).padStart(16, "0");
    case "ascii":
      return formatAsciiByte(word >> 8) + formatAsciiByte(word);
  }
}

export function bytesPerRow(format: DisplayFormat): number {
  switch (format) {
    case "hex":
      return 16;
    case "decimal":
      return 8;
    case "binary":
      return 4;
    case "ascii":
      return 16;
  }
}

export function asciiGlyph(value: number): string {
  const byte = value & 0xff;
  if (byte >= 0x20 && byte <= 0x7e) {
    return String.fromCharCode(byte);
  }
  return ASCII_MIDDLE_DOT;
}

function formatAsciiByte(value: number): string {
  return asciiGlyph(value);
}

export function loadFormat(storage: Pick<Storage, "getItem">): DisplayFormat {
  const stored = storage.getItem(FORMAT_STORAGE_KEY);
  return isDisplayFormat(stored) ? stored : "hex";
}

export function saveFormat(storage: Pick<Storage, "setItem">, format: DisplayFormat): void {
  storage.setItem(FORMAT_STORAGE_KEY, format);
}

export function formatNames(): readonly DisplayFormat[] {
  return FORMATS;
}

export function parseAddress(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  let match = trimmed.match(/^0x([0-9a-f]+)$/i);
  if (match) {
    return clip(parseInt(match[1], 16));
  }
  match = trimmed.match(/^\$([0-9a-f]+)$/i);
  if (match) {
    return clip(parseInt(match[1], 16));
  }
  match = trimmed.match(/^([0-9a-f]+)h$/i);
  if (match) {
    return clip(parseInt(match[1], 16));
  }
  match = trimmed.match(/^%([01]+)$/);
  if (match) {
    return clip(parseInt(match[1], 2));
  }
  match = trimmed.match(/^0b([01]+)$/i);
  if (match) {
    return clip(parseInt(match[1], 2));
  }
  match = trimmed.match(/^([01]+)b$/i);
  if (match) {
    return clip(parseInt(match[1], 2));
  }
  if (/^\d+$/.test(trimmed)) {
    return clip(parseInt(trimmed, 10));
  }
  return undefined;
}

function clip(value: number): number | undefined {
  if (!Number.isFinite(value) || value < 0 || value > 0xffff) {
    return undefined;
  }
  return value;
}
