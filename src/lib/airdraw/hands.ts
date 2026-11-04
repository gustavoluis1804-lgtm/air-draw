import type { Landmark } from "./types";

type P = { x: number; y: number };

/** Max distance (fraction of the frame) a hand can jump between frames and keep its slot. */
export const SLOT_MATCH_DISTANCE = 0.25;

/**
 * Keeps each tracked hand in the same slot from frame to frame by matching it
 * to the nearest previous wrist position (the tracker's own hand order and
 * left/right labels can swap). `prev[s]` is the last wrist of slot `s`, or null
 * when the slot is free. Returns the slot index for every detected hand, or -1
 * when there are more hands than slots.
 */
export function assignSlots(
  prev: (P | null)[],
  detected: P[],
  maxDist = SLOT_MATCH_DISTANCE,
) {
  const result = detected.map(() => -1);
  const taken = prev.map(() => false);
  const pairs: { d: number; i: number; s: number }[] = [];
  detected.forEach((p, i) =>
    prev.forEach((q, s) => {
      if (q) pairs.push({ d: Math.hypot(p.x - q.x, p.y - q.y), i, s });
    }),
  );
  pairs.sort((a, b) => a.d - b.d);
  for (const { d, i, s } of pairs) {
    if (d > maxDist) break;
    if (result[i] !== -1 || taken[s]) continue;
    result[i] = s;
    taken[s] = true;
  }
  // New hands take a free slot first, then any slot nobody matched.
  const order = prev
    .map((q, s) => ({ q, s }))
    .sort((a, b) => Number(a.q !== null) - Number(b.q !== null))
    .map((x) => x.s);
  detected.forEach((_, i) => {
    if (result[i] !== -1) return;
    const s = order.find((k) => !taken[k]);
    if (s === undefined) return;
    result[i] = s;
    taken[s] = true;
  });
  return result;
}

/** Hand size (wrist → middle knuckle) in frame heights at which proximity reads 0% / 100%. */
export const PROXIMITY_FAR = 0.08;
export const PROXIMITY_NEAR = 0.32;

/**
 * How close the hand is to the camera, 0–100, from its apparent size in the
 * frame (more reliable than the tracker's depth value). `aspect` = width / height.
 */
export function handProximity(lm: Landmark[], aspect: number): number | null {
  const wrist = lm[0];
  const knuckle = lm[9];
  if (!wrist || !knuckle) return null;
  const size = Math.hypot((wrist.x - knuckle.x) * aspect, wrist.y - knuckle.y);
  const t = (size - PROXIMITY_FAR) / (PROXIMITY_NEAR - PROXIMITY_FAR);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}
