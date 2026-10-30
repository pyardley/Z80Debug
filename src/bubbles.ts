const MARGIN = 8;
const GAP = 8;

export interface BubbleBox {
  left: number;
  top: number;
  width: number;
  height: number;
  bottom: number;
}

/** Place a help bubble above its anchor, shifting it so the whole bubble stays on screen. */
export function bubbleOrigin(
  anchor: BubbleBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const maxLeft = Math.max(MARGIN, viewport.width - size.width - MARGIN);
  let left = anchor.left + anchor.width / 2 - size.width / 2;
  left = Math.min(Math.max(left, MARGIN), maxLeft);

  let top = anchor.top - size.height - GAP;
  if (top < MARGIN) {
    top = anchor.bottom + GAP;
  }
  const maxTop = Math.max(MARGIN, viewport.height - size.height - MARGIN);
  top = Math.min(Math.max(top, MARGIN), maxTop);
  return { left, top };
}

const homes = new WeakMap<HTMLElement, HTMLElement>();

function hostOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const host = target.closest(".flag, .reg-help");
  return host instanceof HTMLElement ? host : null;
}

function bubbleOf(host: HTMLElement): HTMLElement | null {
  const bubble = host.querySelector(":scope > .flag-bubble, :scope > .reg-bubble");
  if (bubble instanceof HTMLElement) {
    return bubble;
  }
  for (const [open, anchor] of openBubbles) {
    if (anchor === host) {
      return open;
    }
  }
  return null;
}

const openBubbles = new Map<HTMLElement, HTMLElement>();

export function showHelpBubble(anchor: HTMLElement, bubble: HTMLElement): void {
  homes.set(bubble, anchor);
  openBubbles.set(bubble, anchor);
  if (bubble.parentElement !== document.body) {
    document.body.append(bubble);
  }
  bubble.style.display = "block";
  bubble.style.position = "fixed";
  bubble.style.right = "auto";
  bubble.style.bottom = "auto";
  bubble.style.transform = "none";
  bubble.style.margin = "0";
  bubble.style.zIndex = "300";
  const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const designed = (Number.isFinite(rootSize) ? rootSize : 16) * 16;
  const cap = Math.min(designed, Math.max(80, window.innerWidth - MARGIN * 2));
  bubble.style.maxWidth = `${cap}px`;
  bubble.style.left = "0px";
  bubble.style.top = "0px";
  const size = bubble.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const origin = bubbleOrigin(
    {
      left: anchorRect.left,
      top: anchorRect.top,
      width: anchorRect.width,
      height: anchorRect.height,
      bottom: anchorRect.bottom,
    },
    { width: size.width, height: size.height },
    { width: window.innerWidth, height: window.innerHeight },
  );
  bubble.style.left = `${origin.left}px`;
  bubble.style.top = `${origin.top}px`;
}

export function hideHelpBubble(bubble: HTMLElement): void {
  const anchor = homes.get(bubble) ?? openBubbles.get(bubble);
  openBubbles.delete(bubble);
  bubble.removeAttribute("style");
  if (anchor?.isConnected) {
    anchor.append(bubble);
  }
}

export function dismissHelpBubbles(): void {
  for (const bubble of [...openBubbles.keys()]) {
    hideHelpBubble(bubble);
  }
}

function place(host: HTMLElement): void {
  const bubble = bubbleOf(host);
  if (bubble) {
    showHelpBubble(host, bubble);
  }
}

function release(host: HTMLElement): void {
  const bubble = bubbleOf(host);
  if (bubble) {
    hideHelpBubble(bubble);
  }
}

/** Keep flag and register bubbles inside the window, even when a pane clips overflow. */
export function bindHelpBubbles(root: ParentNode): () => void {
  const onOver = (event: Event): void => {
    const host = hostOf(event.target);
    if (host && root.contains(host)) {
      place(host);
    }
  };
  const onOut = (event: MouseEvent): void => {
    const host = hostOf(event.target);
    if (!host || !root.contains(host)) {
      return;
    }
    const next = hostOf(event.relatedTarget);
    if (next !== host) {
      release(host);
    }
  };
  const onFocus = (event: FocusEvent): void => {
    const host = hostOf(event.target);
    if (host && root.contains(host)) {
      place(host);
    }
  };
  const onBlur = (event: FocusEvent): void => {
    const host = hostOf(event.target);
    if (!host) {
      return;
    }
    const next = hostOf(event.relatedTarget);
    if (next !== host) {
      release(host);
    }
  };
  const onReflow = (): void => {
    for (const [bubble, anchor] of openBubbles) {
      if (!anchor.isConnected) {
        hideHelpBubble(bubble);
      } else {
        showHelpBubble(anchor, bubble);
      }
    }
  };

  root.addEventListener("pointerover", onOver);
  root.addEventListener("pointerout", onOut);
  root.addEventListener("mouseover", onOver);
  root.addEventListener("mouseout", onOut);
  root.addEventListener("focusin", onFocus);
  root.addEventListener("focusout", onBlur);
  window.addEventListener("resize", onReflow);
  window.addEventListener("scroll", onReflow, true);
  return () => {
    dismissHelpBubbles();
    root.removeEventListener("pointerover", onOver);
    root.removeEventListener("pointerout", onOut);
    root.removeEventListener("mouseover", onOver);
    root.removeEventListener("mouseout", onOut);
    root.removeEventListener("focusin", onFocus);
    root.removeEventListener("focusout", onBlur);
    window.removeEventListener("resize", onReflow);
    window.removeEventListener("scroll", onReflow, true);
  };
}
