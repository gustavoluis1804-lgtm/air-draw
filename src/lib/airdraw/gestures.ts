import type { Gesture, Landmark } from "./types";

/** Pinch starts below this thumb–index distance (relative to hand size)… */
export const PINCH_ENTER = 0.32;
/** …and only ends above this one, so it doesn't flicker at the edge. */
export const PINCH_EXIT = 0.48;

const EXTENDED_RATIO = 1.15;
const FOLDED_RATIO = 1.08;
const FIST_RATIO = 1.0;
/** In a pinch the index is bent, but never curled into the palm like in a fist. */
const PINCH_MIN_INDEX_RATIO = 0.85;

// MediaPipe hand landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const FINGERS = {
  index: { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring: { pip: 14, tip: 16 },
  pinky: { pip: 18, tip: 20 },
} as const;
const MIDDLE_MCP = 9;

/** Distance in an isotropic space (landmark x is scaled by the frame aspect ratio). */
function d(a: Landmark, b: Landmark, aspect: number) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

/**
 * Rotation-invariant hand metrics: compares distances to the wrist instead of
 * raw y positions, so gestures work with a tilted or sideways hand and at any
 * distance from the camera.
 */
export function handMetrics(landmarks: Landmark[], aspect = 1) {
  const origin: Landmark = { x: 0, y: 0, z: 0 };
  const lm = (i: number) => landmarks[i] ?? origin;
  const wrist = lm(WRIST);
  const handSize = Math.max(d(wrist, lm(MIDDLE_MCP), aspect), 1e-6);
  const ratio = (f: { pip: number; tip: number }) =>
    d(wrist, lm(f.tip), aspect) / Math.max(d(wrist, lm(f.pip), aspect), 1e-6);
  return {
    pinchRatio: d(lm(THUMB_TIP), lm(FINGERS.index.tip), aspect) / handSize,
    index: ratio(FINGERS.index),
    middle: ratio(FINGERS.middle),
    ring: ratio(FINGERS.ring),
    pinky: ratio(FINGERS.pinky),
  };
}

/**
 * Classifies a single frame. `wasPinching` enables pinch hysteresis.
 * `pinchSensitivity` > 1 makes the pinch easier to trigger, < 1 harder.
 */
export function classifyHand(
  lm: Landmark[],
  aspect: number,
  wasPinching: boolean,
  pinchSensitivity = 1,
): Gesture {
  const m = handMetrics(lm, aspect);
  const enter = PINCH_ENTER * pinchSensitivity;
  const exit = PINCH_EXIT * pinchSensitivity;
  const pinchClose = wasPinching ? m.pinchRatio < exit : m.pinchRatio < enter;
  if (pinchClose && m.index > PINCH_MIN_INDEX_RATIO) return "pinch";
  if (m.index > EXTENDED_RATIO && m.middle < FOLDED_RATIO) return "point";
  // Two fingers up (V sign): index + middle extended, ring + pinky folded → eraser.
  if (
    m.index > EXTENDED_RATIO &&
    m.middle > EXTENDED_RATIO &&
    m.ring < FOLDED_RATIO &&
    m.pinky < FOLDED_RATIO
  )
    return "erase";
  const fingers = [m.index, m.middle, m.ring, m.pinky];
  if (fingers.every((r) => r > EXTENDED_RATIO)) return "open";
  if (fingers.every((r) => r < FIST_RATIO)) return "fist";
  return "idle";
}

/** Thumb–index spread (relative to hand size) of a "pinch-spread" pose, or null for other poses. */
export function spreadRatio(lm: Landmark[], aspect: number): number | null {
  const m = handMetrics(lm, aspect);
  // Middle, ring and pinky folded: only thumb and index are used to show the size.
  if (
    m.middle < FOLDED_RATIO &&
    m.ring < FOLDED_RATIO &&
    m.pinky < FOLDED_RATIO
  ) {
    return m.pinchRatio;
  }
  return null;
}

/**
 * Debounces gestures: a new gesture must hold for `framesToSwitch` frames before
 * it takes effect, and a briefly lost hand keeps its last gesture for
 * `lostGrace` frames, so one bad frame doesn't break a stroke.
 */
export class GestureStabilizer {
  current: Gesture = "none";
  private candidate: Gesture | null = null;
  private candidateCount = 0;
  private lost = 0;

  constructor(
    private framesToSwitch = 3,
    private lostGrace = 4,
  ) {}

  update(raw: Gesture): Gesture {
    if (raw === "none") {
      this.lost++;
      if (this.lost > this.lostGrace) {
        this.current = "none";
        this.candidate = null;
        this.candidateCount = 0;
      }
      return this.current;
    }
    this.lost = 0;
    if (raw === this.current) {
      this.candidate = null;
      this.candidateCount = 0;
      return this.current;
    }
    if (raw === this.candidate) this.candidateCount++;
    else {
      this.candidate = raw;
      this.candidateCount = 1;
    }
    if (this.candidateCount >= this.framesToSwitch) {
      this.current = raw;
      this.candidate = null;
      this.candidateCount = 0;
    }
    return this.current;
  }

  reset() {
    this.current = "none";
    this.candidate = null;
    this.candidateCount = 0;
    this.lost = 0;
  }
}
