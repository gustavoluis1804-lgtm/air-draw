type P = { x: number; y: number };

export type ShapeKind = "line" | "circle" | "rect" | "v";
export type ShapeResult = { kind: ShapeKind; points: P[] };

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  line: "linha",
  circle: "círculo",
  rect: "retângulo",
  v: "V",
};

function pathLength(pts: P[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++)
    l += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return l;
}

function lerp(a: P, b: P, t: number): P {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function maxDeviation(pts: P[], a: P, b: P) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let m = 0;
  for (const p of pts)
    m = Math.max(m, Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len);
  return m;
}

/** A "V": two straight strokes meeting at a sharp vertex (open, not closed). */
function recognizeV(pts: P[], L: number, chord: number): ShapeResult | null {
  if (chord / L < 0.3 || chord / L > 0.92) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let k = 0;
  let best = -1;
  pts.forEach((p, i) => {
    const d = Math.abs(
      (p.x - first.x) * (last.y - first.y) -
        (p.y - first.y) * (last.x - first.x),
    );
    if (d > best) {
      best = d;
      k = i;
    }
  });
  const v = pts[k]!;
  const la = Math.hypot(v.x - first.x, v.y - first.y);
  const lb = Math.hypot(last.x - v.x, last.y - v.y);
  if (la < 0.2 * L || lb < 0.2 * L || la + lb < 0.9 * L) return null;
  if (maxDeviation(pts.slice(0, k + 1), first, v) > 0.07 * L) return null;
  if (maxDeviation(pts.slice(k), v, last) > 0.07 * L) return null;
  const cos =
    ((first.x - v.x) * (last.x - v.x) + (first.y - v.y) * (last.y - v.y)) /
    (la * lb);
  if (cos < -0.5) return null; // wider than 120° is just a bent line
  const out: P[] = [];
  for (let i = 0; i < 12; i++) out.push(lerp(first, v, i / 12));
  for (let i = 0; i <= 12; i++) out.push(lerp(v, last, i / 12));
  return { kind: "v", points: out };
}

/**
 * Recognizes a hand-drawn line, V, circle/ellipse or rectangle (points in pixels)
 * and returns a clean version of it, or null when the stroke is free-form.
 */
export function recognizeShape(pts: P[]): ShapeResult | null {
  if (pts.length < 8) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const L = pathLength(pts);
  if (L < 40) return null;

  // Line: almost as long as its chord and never far from it.
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  if (chord / L > 0.92) {
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    let maxDev = 0;
    for (const p of pts) {
      maxDev = Math.max(
        maxDev,
        Math.abs((p.x - first.x) * dy - (p.y - first.y) * dx) / chord,
      );
    }
    if (maxDev < 0.06 * L) {
      return {
        kind: "line",
        points: Array.from({ length: 24 }, (_, i) => lerp(first, last, i / 23)),
      };
    }
    return null;
  }

  const vShape = recognizeV(pts, L, chord);
  if (vShape) return vShape;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const diag = Math.hypot(w, h);
  const minSide = Math.min(w, h);
  if (minSide < 12) return null;

  // Must be (nearly) closed.
  if (chord > Math.max(0.3 * diag, 24)) return null;

  // Rectangle: hugs the bounding box edges and visits every corner.
  const corners: P[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  const edgeDist =
    pts.reduce(
      (a, p) => a + Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y),
      0,
    ) /
    pts.length /
    minSide;
  const cornersVisited = corners.every((c) =>
    pts.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 0.15 * minSide),
  );
  if (edgeDist < 0.07 && cornersVisited) {
    const out: P[] = [];
    for (let e = 0; e < 4; e++) {
      const a = corners[e]!;
      const b = corners[(e + 1) % 4]!;
      for (let i = 0; i < 8; i++) out.push(lerp(a, b, i / 8));
    }
    out.push(corners[0]!);
    return { kind: "rect", points: out };
  }

  // Ellipse fitted to the bounding box.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = w / 2;
  const ry = h / 2;
  const err =
    pts.reduce(
      (a, p) => a + Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1),
      0,
    ) / pts.length;
  if (err < 0.12) {
    const start = Math.atan2((first.y - cy) / ry, (first.x - cx) / rx);
    // Keep the drawing direction.
    let area = 0;
    for (let i = 1; i < pts.length; i++)
      area += pts[i - 1]!.x * pts[i]!.y - pts[i]!.x * pts[i - 1]!.y;
    const dir = area >= 0 ? 1 : -1;
    const n = 64;
    return {
      kind: "circle",
      points: Array.from({ length: n + 1 }, (_, i) => {
        const a = start + dir * (i / n) * Math.PI * 2;
        return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
      }),
    };
  }
  return null;
}
