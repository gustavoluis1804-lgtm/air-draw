import type { Stroke } from "./types";

export type RenderTheme = { highlight: string; core: string };
export type RenderOptions = {
  neon: boolean;
  highlightId?: string | null;
  theme: RenderTheme;
};

function tracePath(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
) {
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last.x, last.y);
}

/** Draws strokes (stored in 0..1 coordinates) onto a canvas of size w×h CSS px. */
export function renderStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  w: number,
  h: number,
  { neon, highlightId, theme }: RenderOptions,
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (!s.points.length) continue;
    const pts = s.points.map((p) => ({ x: p.x * w, y: p.y * h, p: p.p }));

    if (pts.length === 1) {
      ctx.save();
      if (neon) {
        ctx.shadowColor = s.color;
        ctx.shadowBlur = s.size * 2;
      }
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(pts[0]!.x, pts[0]!.y, s.size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    if (s.id === highlightId) {
      ctx.save();
      ctx.strokeStyle = theme.highlight;
      ctx.lineWidth = s.size * 1.3 + 12;
      tracePath(ctx, pts);
      ctx.stroke();
      ctx.restore();
    }

    if (neon) {
      ctx.save();
      ctx.shadowColor = s.color;
      ctx.shadowBlur = s.size * 2.2;
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = s.size;
      tracePath(ctx, pts);
      ctx.stroke();
      ctx.restore();
    }

    // Variable width body (speed-based pressure)
    ctx.save();
    ctx.strokeStyle = s.color;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      ctx.lineWidth = s.size * ((a.p + b.p) / 2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    if (neon) {
      ctx.save();
      ctx.strokeStyle = theme.core;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1, s.size * 0.28);
      tracePath(ctx, pts);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Resolves any CSS color (including oklch) to a #rrggbb string. Browser only. */
export function cssColorToHex(color: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d");
  if (!ctx) return "#000000";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function readCssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** Bone pairs of the 21-point MediaPipe hand. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];
const FINGERTIPS = [4, 8, 12, 16, 20];

/** Draws a light hand skeleton with fingertip dots (points already in stage pixels). */
export function renderHands(
  ctx: CanvasRenderingContext2D,
  hands: { points: { x: number; y: number }[]; color: string }[],
) {
  ctx.lineCap = "round";
  for (const { points, color } of hands) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = points[a];
      const pb = points[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    for (const i of FINGERTIPS) {
      const p = points[i];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 8 ? 6 : 4, 0, Math.PI * 2);
      if (i === 8) {
        ctx.lineWidth = 2;
        ctx.stroke();
      } else ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
