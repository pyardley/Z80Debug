/** Text after the first semicolon, or nothing when the line has no comment. */
export function trailingComment(line: string | undefined): string | undefined {
  if (line === undefined) {
    return undefined;
  }
  const mark = line.indexOf(";");
  if (mark < 0) {
    return undefined;
  }
  const text = line.slice(mark + 1).trim();
  return text === "" ? undefined : text;
}

export interface CommentSides {
  /** Bank currently shown as the live AF. */
  af: "main" | "alt";
  /** Bank currently shown as the live BC, DE, and HL. */
  exx: "main" | "alt";
}

/**
 * Registers a machine instruction writes with data.
 * A refresh of R, a flag side effect, and the ordinary PC advance are not writes.
 * `jumped` is true when PC did not simply move to the next instruction.
 */
export function destinationKeys(mnemonic: string, sides: CommentSides, jumped = false): string[] {
  const text = mnemonic.trim().toUpperCase().replace(/\s+/g, " ");
  const parsed = /^([A-Z]+)\s*(.*)$/.exec(text);
  if (parsed === null) {
    return [];
  }
  const op = parsed[1];
  const args = splitArgs(parsed[2]);
  const keys = new Set<string>();
  const add = (token: string | undefined) => {
    for (const key of keysForToken(token, sides)) {
      keys.add(key);
    }
  };

  if (op === "EX" && args[0] === "AF") {
    for (const side of ["main", "alt"] as const) {
      keys.add(`${side}.a`);
      keys.add(`${side}.f`);
    }
  } else if (op === "EXX") {
    for (const side of ["main", "alt"] as const) {
      for (const part of ["b", "c", "d", "e", "h", "l"]) {
        keys.add(`${side}.${part}`);
      }
    }
  } else if (op === "EX" && args[0]?.startsWith("(")) {
    add(args[1]);
  } else if (op === "EX") {
    add(args[0]);
    add(args[1]);
  } else if (op === "LD" || op === "INC" || op === "DEC" || op === "POP"
    || op === "RL" || op === "RR" || op === "SLA" || op === "SRA" || op === "SRL" || op === "SLL"
    || op === "RLC" || op === "RRC") {
    add(args[0]);
  } else if (op === "SET" || op === "RES") {
    add(args[1]);
  } else if (op === "ADD" || op === "ADC" || op === "SBC") {
    add(args[0]);
  } else if (op === "SUB" || op === "AND" || op === "OR" || op === "XOR"
    || op === "DAA" || op === "CPL" || op === "NEG"
    || op === "RLCA" || op === "RRCA" || op === "RLA" || op === "RRA"
    || op === "RLD" || op === "RRD") {
    add("A");
  } else if (op === "IN") {
    add(args[0]);
  } else if (op === "DJNZ") {
    add("B");
  } else if (op === "LDI" || op === "LDD" || op === "LDIR" || op === "LDDR") {
    add("H");
    add("L");
    add("D");
    add("E");
    add("B");
    add("C");
  } else if (op === "CPI" || op === "CPD" || op === "CPIR" || op === "CPDR") {
    add("H");
    add("L");
    add("B");
    add("C");
  } else if (op === "INI" || op === "IND" || op === "INIR" || op === "INDR"
    || op === "OUTI" || op === "OUTD" || op === "OTIR" || op === "OTDR") {
    add("B");
    add("H");
    add("L");
  }

  if (jumped && (op === "JP" || op === "JR" || op === "DJNZ" || op === "CALL" || op === "RET" || op === "RETI" || op === "RETN" || op === "RST")) {
    keys.add("pc");
  }
  return [...keys];
}

const PAIRS: Record<string, readonly string[]> = {
  AF: ["a", "f"],
  BC: ["b", "c"],
  DE: ["d", "e"],
  HL: ["h", "l"],
};

const BYTES: Record<string, string> = {
  A: "a",
  F: "f",
  B: "b",
  C: "c",
  D: "d",
  E: "e",
  H: "h",
  L: "l",
  IXH: "ixh",
  IXL: "ixl",
  IYH: "iyh",
  IYL: "iyl",
};

function keysForToken(token: string | undefined, sides: CommentSides): string[] {
  if (token === undefined) {
    return [];
  }
  const name = token.trim().toUpperCase();
  if (name === "" || name.startsWith("(") || name.includes("'")) {
    return [];
  }
  if (/^0X[0-9A-F]+$/.test(name) || /^\d+$/.test(name)) {
    return [];
  }
  if (name === "IX") {
    return ["ixh", "ixl"];
  }
  if (name === "IY") {
    return ["iyh", "iyl"];
  }
  if (name === "SP") {
    return ["sp"];
  }
  if (name === "I") {
    return ["i"];
  }
  if (name === "R") {
    return ["r"];
  }
  const pair = PAIRS[name];
  if (pair !== undefined) {
    return pair.map((part) => place(part, sides));
  }
  const byte = BYTES[name];
  if (byte === undefined) {
    return [];
  }
  if (byte.startsWith("ix") || byte.startsWith("iy")) {
    return [byte];
  }
  return [place(byte, sides)];
}

function place(part: string, sides: CommentSides): string {
  const side = part === "a" || part === "f" ? sides.af : sides.exx;
  return `${side}.${part}`;
}

function splitArgs(rest: string): string[] {
  if (rest.trim() === "") {
    return [];
  }
  const args: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of rest) {
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
    }
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") {
    args.push(current.trim());
  }
  return args;
}
