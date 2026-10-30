import { describe, expect, it } from "vitest";
import { bubbleOrigin } from "./bubbles";

describe("help bubbles", () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 200, height: 80 };

  it("sits above the anchor when there is room", () => {
    expect(bubbleOrigin({ left: 300, top: 200, width: 40, height: 20, bottom: 220 }, size, viewport)).toEqual({
      left: 220,
      top: 112,
    });
  });

  it("shifts left so a bubble at the right edge stays on screen", () => {
    const origin = bubbleOrigin(
      { left: 760, top: 200, width: 30, height: 20, bottom: 220 },
      size,
      viewport,
    );
    expect(origin.left + size.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(origin.left).toBeGreaterThanOrEqual(8);
    expect(origin.top).toBe(112);
  });

  it("shifts right so a bubble at the left edge stays on screen", () => {
    const origin = bubbleOrigin(
      { left: 0, top: 200, width: 20, height: 20, bottom: 220 },
      size,
      viewport,
    );
    expect(origin.left).toBe(8);
  });

  it("drops below the anchor when the top of the window is too close", () => {
    const origin = bubbleOrigin(
      { left: 300, top: 10, width: 40, height: 20, bottom: 30 },
      size,
      viewport,
    );
    expect(origin.top).toBe(38);
  });
});
