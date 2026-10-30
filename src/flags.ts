export const FLAG_BITS: { key: string; label: string; mask: number }[] = [
  { key: "s", label: "S", mask: 0x80 },
  { key: "z", label: "Z", mask: 0x40 },
  { key: "h", label: "H", mask: 0x10 },
  { key: "pv", label: "P/V", mask: 0x04 },
  { key: "n", label: "N", mask: 0x02 },
  { key: "c", label: "C", mask: 0x01 },
];

/** The bubble is these sentences and nothing more. */
export const FLAG_HELP: Record<string, string> = {
  s: "S, Sign. Set when bit 7 of the result is 1, so a signed byte reads as negative.",
  z: "Z, Zero. Set when the result is 0.",
  h: "H, Half carry. Set when a carry or borrow happens between bit 3 and bit 4. DAA uses this to adjust BCD.",
  pv: "P/V, Parity or overflow. After a logic operation, set when the result has an even number of 1 bits. After arithmetic, set when the signed result does not fit in the register.",
  n: "N, Subtract. Set after a subtraction and clear after an addition. DAA uses this.",
  c: "C, Carry. Set when an unsigned add or subtract does not fit, or when a shift or rotate pushes a bit out.",
};

/** Short label on the strip, and the same kind of explanation a flag bubble uses. */
export const REGISTER_HELP = {
  i: {
    label: "I page",
    help: "I, Interrupt page. The high byte of the address used in interrupt mode 2. The device supplies the low byte.",
  },
  r: {
    label: "R refresh",
    help: "R, Memory refresh. Increments as instructions run so dynamic memory can be refreshed.",
  },
} as const;

/** Letter and 0/1 share one bubble. */
export function appendFlagParts(bit: HTMLElement, key: string, on: boolean): void {
  const flag = FLAG_BITS.find((item) => item.key === key);
  const name = document.createElement("span");
  name.className = "flag-name";
  name.textContent = flag?.label ?? key;
  const state = document.createElement("span");
  state.className = "flag-state";
  state.textContent = on ? "1" : "0";
  const bubble = document.createElement("span");
  bubble.className = "flag-bubble";
  bubble.setAttribute("role", "tooltip");
  bubble.textContent = FLAG_HELP[key] ?? "";
  bit.append(name, state, bubble);
}
