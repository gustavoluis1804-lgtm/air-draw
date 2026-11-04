type Size = { w: number; h: number };

/**
 * Maps a normalized landmark from the raw camera frame onto the stage, matching
 * a <video> rendered with `object-fit: cover` (cropped edges) and optionally
 * mirrored with `transform: scaleX(-1)`.
 */
export function coverMap(
  point: { x: number; y: number },
  video: Size,
  stage: Size,
  mirrored = true,
): { x: number; y: number } {
  if (video.w <= 0 || video.h <= 0) {
    const x = point.x * stage.w;
    return { x: mirrored ? stage.w - x : x, y: point.y * stage.h };
  }
  const scale = Math.max(stage.w / video.w, stage.h / video.h);
  const dw = video.w * scale;
  const dh = video.h * scale;
  const offsetX = (stage.w - dw) / 2;
  const offsetY = (stage.h - dh) / 2;
  const nx = mirrored ? 1 - point.x : point.x;
  return { x: offsetX + nx * dw, y: offsetY + point.y * dh };
}

/** Distance from point p to segment ab. */
export function distToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
