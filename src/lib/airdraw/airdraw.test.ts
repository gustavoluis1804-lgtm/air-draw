import { describe, expect, it } from "vitest";

import { DrawingEngine } from "./engine";
import { coverMap } from "./geometry";
import { classifyHand, GestureStabilizer } from "./gestures";
import type { Landmark } from "./types";

/** Builds a synthetic 21-point hand pointing in direction `angle` (radians). */
function makeHand(opts: {
  angle?: number;
  extended: { index: boolean; middle: boolean; ring: boolean; pinky: boolean };
  pinch?: boolean;
}): Landmark[] {
  const angle = opts.angle ?? -Math.PI / 2; // up on screen
  const cx = 0.5;
  const cy = 0.6;
  const rot = (dx: number, dy: number): Landmark => ({
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle),
    z: 0,
  });
  // local frame: +x along the hand, +y across the palm
  const lm: Landmark[] = new Array(21).fill(null).map(() => rot(0, 0));
  const finger = (base: number, offsetY: number, ext: boolean) => {
    lm[base] = rot(0.1, offsetY); // MCP
    lm[base + 1] = rot(0.14, offsetY); // PIP
    lm[base + 2] = ext ? rot(0.17, offsetY) : rot(0.12, offsetY * 0.6); // DIP
    lm[base + 3] = ext ? rot(0.2, offsetY) : rot(0.09, offsetY * 0.5); // TIP
  };
  lm[0] = rot(0, 0);
  finger(5, -0.03, opts.extended.index);
  finger(9, 0, opts.extended.middle);
  finger(13, 0.03, opts.extended.ring);
  finger(17, 0.055, opts.extended.pinky);
  const tip = lm[8]!;
  lm[4] = opts.pinch ? { ...tip, x: tip.x + 0.005 } : rot(0.07, -0.09);
  return lm;
}

const POINTING = { index: true, middle: false, ring: false, pinky: false };
const OPEN = { index: true, middle: true, ring: true, pinky: true };
const V_SIGN = { index: true, middle: true, ring: false, pinky: false };

describe("coverMap (cursor alignment with object-fit: cover)", () => {
  it("accounts for the cropped edges of a 16:9 video on a square stage", () => {
    // 1280x720 video on a 600x600 stage: scaled to 1066.67x600, 233.33px cropped each side.
    const p = coverMap(
      { x: 0.5, y: 0.5 },
      { w: 1280, h: 720 },
      { w: 600, h: 600 },
      false,
    );
    expect(p.x).toBeCloseTo(300);
    expect(p.y).toBeCloseTo(300);
    const left = coverMap(
      { x: 0.25, y: 0 },
      { w: 1280, h: 720 },
      { w: 600, h: 600 },
      false,
    );
    expect(left.x).toBeCloseTo(-233.333 + 0.25 * 1066.667, 1);
  });

  it("mirrors x like the selfie preview", () => {
    const p = coverMap(
      { x: 0.25, y: 0.5 },
      { w: 1280, h: 720 },
      { w: 1280, h: 720 },
      true,
    );
    expect(p.x).toBeCloseTo(960);
  });
});

describe("gesture classification", () => {
  it("recognizes pointing with the hand upright and sideways", () => {
    expect(classifyHand(makeHand({ extended: POINTING }), 1, false)).toBe(
      "point",
    );
    expect(
      classifyHand(makeHand({ extended: POINTING, angle: 0 }), 1, false),
    ).toBe("point");
    expect(
      classifyHand(
        makeHand({ extended: POINTING, angle: Math.PI * 0.8 }),
        1,
        false,
      ),
    ).toBe("point");
  });

  it("recognizes an open hand (paused, used for hand commands)", () => {
    expect(classifyHand(makeHand({ extended: OPEN }), 1, false)).toBe("open");
  });

  it("detects a pinch", () => {
    expect(
      classifyHand(makeHand({ extended: POINTING, pinch: true }), 1, false),
    ).toBe("pinch");
  });

  it("treats two fingers up (V sign) as the eraser, upright and sideways", () => {
    expect(classifyHand(makeHand({ extended: V_SIGN }), 1, false)).toBe(
      "erase",
    );
    expect(
      classifyHand(makeHand({ extended: V_SIGN, angle: 0 }), 1, false),
    ).toBe("erase");
  });

  it("does not confuse the eraser with an open hand", () => {
    const threeUp = { index: true, middle: true, ring: true, pinky: false };
    expect(classifyHand(makeHand({ extended: threeUp }), 1, false)).not.toBe(
      "erase",
    );
  });
});

describe("GestureStabilizer", () => {
  it("needs 3 consecutive frames before switching gesture", () => {
    const s = new GestureStabilizer(3, 4);
    expect(s.update("point")).toBe("none");
    expect(s.update("point")).toBe("none");
    expect(s.update("point")).toBe("point");
    expect(s.update("pinch")).toBe("point"); // a single odd frame is ignored
    expect(s.update("point")).toBe("point");
  });

  it("keeps the gesture through a brief tracking loss", () => {
    const s = new GestureStabilizer(1, 4);
    s.update("point");
    for (let i = 0; i < 4; i++) expect(s.update("none")).toBe("point");
    expect(s.update("none")).toBe("none");
  });
});

describe("DrawingEngine history", () => {
  const brush = { color: "#fff", size: 8 };
  const draw = (e: DrawingEngine, x: number, y: number) => {
    e.begin("draw", { x, y, t: 0 }, brush);
    e.update({ x: x + 50, y, t: 16 });
    e.end();
  };

  it("undoes and redoes a stroke", () => {
    const e = new DrawingEngine();
    e.setViewport(100, 100);
    draw(e, 10, 10);
    expect(e.strokes).toHaveLength(1);
    e.undo();
    expect(e.strokes).toHaveLength(0);
    e.redo();
    expect(e.strokes).toHaveLength(1);
  });

  it("makes moving a stroke undoable", () => {
    const e = new DrawingEngine();
    e.setViewport(100, 100);
    draw(e, 10, 10);
    const before = e.strokes[0]!.points[0]!.x;
    e.begin("move", { x: 20, y: 10, t: 0 }, brush);
    e.update({ x: 40, y: 10, t: 16 });
    e.end();
    expect(e.strokes[0]!.points[0]!.x).toBeCloseTo(before + 0.2);
    e.undo();
    expect(e.strokes[0]!.points[0]!.x).toBeCloseTo(before);
  });

  it("erases a touched stroke and can bring it back", () => {
    const e = new DrawingEngine();
    e.setViewport(100, 100);
    draw(e, 10, 10);
    e.begin("erase", { x: 30, y: 10, t: 0 }, brush);
    e.end();
    expect(e.strokes).toHaveLength(0);
    e.undo();
    expect(e.strokes).toHaveLength(1);
  });

  it("does not add an undo step when erasing empty space", () => {
    const e = new DrawingEngine();
    e.setViewport(100, 100);
    draw(e, 10, 10);
    e.begin("erase", { x: 90, y: 90, t: 0 }, brush);
    e.end();
    e.undo();
    expect(e.strokes).toHaveLength(0); // the undo removed the drawn stroke, not a no-op erase
  });

  it("keeps clear undoable", () => {
    const e = new DrawingEngine();
    e.setViewport(100, 100);
    draw(e, 10, 10);
    draw(e, 10, 50);
    e.clear();
    expect(e.strokes).toHaveLength(0);
    e.undo();
    expect(e.strokes).toHaveLength(2);
  });

  it("adds AI-generated strokes as an undoable step", () => {
    const e = new DrawingEngine();
    e.setViewport(100, 100);
    draw(e, 10, 10);
    expect(e.strokes).toHaveLength(1);

    const generated = [
      {
        id: "gen1",
        color: "#00f0ff",
        size: 4,
        points: [{ x: 0.2, y: 0.2, z: 0, p: 1 }],
      },
      {
        id: "gen2",
        color: "#ff0055",
        size: 4,
        points: [{ x: 0.4, y: 0.4, z: 0, p: 1 }],
      },
    ];
    e.addStrokes(generated);
    expect(e.strokes).toHaveLength(3);

    e.undo();
    expect(e.strokes).toHaveLength(1);
    e.redo();
    expect(e.strokes).toHaveLength(3);
  });

  it("replaces strokes with an undoable step", () => {
    const e = new DrawingEngine();
    e.setViewport(100, 100);
    draw(e, 10, 10);
    expect(e.strokes).toHaveLength(1);

    const replacement = [
      {
        id: "rep1",
        color: "#ffd700",
        size: 6,
        points: [{ x: 0.5, y: 0.5, z: 0, p: 1 }],
      },
    ];
    e.replaceStrokes(replacement);
    expect(e.strokes).toHaveLength(1);
    expect(e.strokes[0]!.id).toBe("rep1");

    e.undo();
    expect(e.strokes).toHaveLength(1);
    expect(e.strokes[0]!.id).not.toBe("rep1");
  });
});
