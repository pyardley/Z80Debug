/** Replace a shown value with a one-line editor. Enter commits, Escape or blur cancels. */
export function openValueEditor(
  target: HTMLElement,
  initial: string,
  commit: (text: string) => boolean,
): void {
  if (target.querySelector("input") !== null) {
    return;
  }
  const previous = target.textContent ?? "";
  const input = document.createElement("input");
  input.className = "value-edit";
  input.value = initial;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "New value");
  target.replaceChildren(input);
  input.focus();
  input.select();
  let settled = false;
  const finish = (accept: boolean): void => {
    if (settled) {
      return;
    }
    if (accept) {
      if (!commit(input.value)) {
        input.classList.add("invalid");
        input.focus();
        return;
      }
      settled = true;
      return;
    }
    settled = true;
    target.textContent = previous;
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => {
    finish(false);
  });
}

export function isWordKey(key: string): boolean {
  return key === "pc" || key === "sp" || key === "ix" || key === "iy" || /\.(af|bc|de|hl)$/.test(key);
}
