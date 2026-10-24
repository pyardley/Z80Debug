export function readdirSync(_dir: string): string[] {
  throw new Error("Directory includes are not available in this debugger.");
}

export function readFileSync(_file: string): Uint8Array {
  throw new Error("Binary inserts are not available in this debugger.");
}
