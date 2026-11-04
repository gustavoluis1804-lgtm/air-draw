import { clamp, distToSegment } from "./geometry";
import { recognizeShape, type ShapeKind } from "./shapes";
import type { Brush, InputSample, Stroke, StrokePoint, Tool } from "./types";

const HISTORY_LIMIT = 100;
const MIN_POINT_DISTANCE_PX = 1.5;
const ERASE_RADIUS_PX = 18;
const PICK_RADIUS_PX = 22;
/** Light-painting strokes fade out over this time. */
export const LIGHT_FADE_MS = 2600;

/** Key used when no input key is given (mouse / touch). */
export const MAIN_INPUT = "main";

type Active =
  | { kind: "draw"; stroke: Stroke; last: InputSample }
  | {
      kind: "move";
      id: string;
      last: InputSample;
      moved: boolean;
      snap: Stroke[];
    }
  | { kind: "erase"; removed: boolean; snap: Stroke[] }
  | { kind: "move-empty" };

/** A clean shape recognized for a just-finished stroke, waiting to be applied. */
type Suggestion = { stroke: Stroke; kind: ShapeKind; points: StrokePoint[] };

export type EndResult = {
  kind: Active["kind"];
  /** True when the interaction actually changed the drawing. */
  changed: boolean;
  points?: number;
  shape?: ShapeKind;
  light?: boolean;
};

let idCounter = 0;
function newId() {
  idCounter += 1;
  return `s${Date.now().toString(36)}${idCounter}`;
}

/**
 * Framework-agnostic drawing state: strokes, undo/redo history and the
 * draw/move/erase interactions. Every change (including moves and erases) is
 * undoable — except light-painting strokes, which fade away on their own.
 */
export class DrawingEngine {
  strokes: Stroke[] = [];
  /** Snap freehand lines, circles and rectangles into clean shapes when a stroke ends. */
  snapShapes = false;
  private undoStack: Stroke[][] = [];
  private redoStack: Stroke[][] = [];
  /** One active interaction per input (mouse, hand 1, hand 2…), so two hands can draw at once. */
  private actives = new Map<string, Active>();
  private suggestion: Suggestion | null = null;
  private listeners = new Set<() => void>();
  private w = 1;
  private h = 1;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  setViewport(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get isActive() {
    return this.actives.size > 0;
  }
  activeKind(key = MAIN_INPUT) {
    return this.actives.get(key)?.kind ?? null;
  }
  get movingId() {
    for (const a of this.actives.values()) if (a.kind === "move") return a.id;
    return null;
  }
  /** Shape recognized for the last stroke (still unchanged), or null. */
  get shapeSuggestion(): ShapeKind | null {
    const sg = this.suggestion;
    return sg && this.strokes.includes(sg.stroke) ? sg.kind : null;
  }
  get hasLight() {
    return this.strokes.some((s) => s.light);
  }
  /** Strokes that are kept: everything except fading light strokes. */
  get savedStrokes() {
    return this.strokes.filter((s) => !s.light);
  }

  private snapshot() {
    const snap = this.strokes;
    this.undoStack.push(snap);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    return snap;
  }

  /** Removes an undo step that turned out to change nothing. */
  private dropSnapshot(snap: Stroke[]) {
    const i = this.undoStack.lastIndexOf(snap);
    if (i >= 0) this.undoStack.splice(i, 1);
  }

  private toPoint(s: InputSample, p: number, keepTime: boolean): StrokePoint {
    const pt: StrokePoint = {
      x: s.x / this.w,
      y: s.y / this.h,
      z: s.z ?? 0,
      p,
    };
    if (keepTime) pt.t = s.t;
    return pt;
  }

  /** Returns the id of the top-most (non-light) stroke under the given stage pixel point. */
  hitTest(
    pt: { x: number; y: number },
    radius = PICK_RADIUS_PX,
  ): string | null {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]!;
      if (s.light) continue;
      const r = radius + s.size / 2;
      const pts = s.points.map((p) => ({ x: p.x * this.w, y: p.y * this.h }));
      const first = pts[0];
      if (
        pts.length === 1 &&
        first &&
        Math.hypot(pt.x - first.x, pt.y - first.y) <= r
      )
        return s.id;
      for (let j = 1; j < pts.length; j++) {
        if (distToSegment(pt, pts[j - 1]!, pts[j]!) <= r) return s.id;
      }
    }
    return null;
  }

  begin(tool: Tool, sample: InputSample, brush: Brush, key = MAIN_INPUT) {
    if (this.actives.has(key)) this.end(key);
    if (tool === "draw") {
      const light = !!brush.light;
      const stroke: Stroke = {
        id: newId(),
        color: brush.color,
        size: brush.size,
        points: [this.toPoint(sample, 1, light)],
        ...(brush.kind && brush.kind !== "solid" ? { brush: brush.kind } : {}),
        ...(light ? { light: true } : {}),
      };
      if (!light) this.snapshot();
      this.strokes = [...this.strokes, stroke];
      this.actives.set(key, { kind: "draw", stroke, last: sample });
    } else if (tool === "move") {
      const id = this.hitTest(sample);
      if (!id) {
        this.actives.set(key, { kind: "move-empty" });
        return;
      }
      const snap = this.snapshot();
      this.strokes = [...this.strokes];
      this.actives.set(key, {
        kind: "move",
        id,
        last: sample,
        moved: false,
        snap,
      });
    } else {
      const a: Active = {
        kind: "erase",
        removed: false,
        snap: this.snapshot(),
      };
      this.actives.set(key, a);
      this.eraseAt(sample, a);
    }
    this.emit();
  }

  update(sample: InputSample, key = MAIN_INPUT) {
    const a = this.actives.get(key);
    if (!a) return;
    if (a.kind === "draw") {
      const dist = Math.hypot(sample.x - a.last.x, sample.y - a.last.y);
      if (dist < MIN_POINT_DISTANCE_PX) return;
      const dt = Math.max(sample.t - a.last.t, 1);
      const speed = dist / dt; // px per ms
      const target = clamp(1.3 - speed * 0.35, 0.45, 1.3);
      const prevP = a.stroke.points[a.stroke.points.length - 1]?.p ?? 1;
      a.stroke.points.push(
        this.toPoint(sample, prevP * 0.7 + target * 0.3, !!a.stroke.light),
      );
      a.last = sample;
      this.emit();
    } else if (a.kind === "move") {
      const dx = (sample.x - a.last.x) / this.w;
      const dy = (sample.y - a.last.y) / this.h;
      if (dx === 0 && dy === 0) return;
      this.strokes = this.strokes.map((s) =>
        s.id === a.id
          ? {
              ...s,
              points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
            }
          : s,
      );
      a.last = sample;
      a.moved = true;
      this.emit();
    } else if (a.kind === "erase") {
      this.eraseAt(sample, a);
    }
  }

  private eraseAt(sample: InputSample, a: Extract<Active, { kind: "erase" }>) {
    const id = this.hitTest(sample, ERASE_RADIUS_PX);
    if (!id) return;
    this.strokes = this.strokes.filter((s) => s.id !== id);
    a.removed = true;
    this.emit();
  }

  end(key = MAIN_INPUT): EndResult | null {
    const a = this.actives.get(key);
    this.actives.delete(key);
    if (!a) return null;
    const result: EndResult = { kind: a.kind, changed: false };
    if (a.kind === "erase") {
      result.changed = a.removed;
      // Erasing nothing shouldn't leave an empty undo step.
      if (!a.removed) this.dropSnapshot(a.snap);
    } else if (a.kind === "move") {
      result.changed = a.moved;
      if (!a.moved) this.dropSnapshot(a.snap);
    } else if (a.kind === "draw") {
      result.changed = true;
      result.points = a.stroke.points.length;
      result.light = !!a.stroke.light;
      this.suggestion = null;
      if (!a.stroke.light) {
        const shape = recognizeShape(
          a.stroke.points.map((p) => ({ x: p.x * this.w, y: p.y * this.h })),
        );
        if (shape) {
          const meanZ =
            a.stroke.points.reduce((s, p) => s + p.z, 0) /
            a.stroke.points.length;
          const points = shape.points.map((p) => ({
            x: p.x / this.w,
            y: p.y / this.h,
            z: meanZ,
            p: 1,
          }));
          result.shape = shape.kind;
          if (this.snapShapes) {
            // Part of the same undo step as the stroke itself.
            const clean: Stroke = { ...a.stroke, points };
            this.strokes = this.strokes.map((s) =>
              s === a.stroke ? clean : s,
            );
          } else {
            this.suggestion = { stroke: a.stroke, kind: shape.kind, points };
          }
        }
      }
    }
    this.emit();
    return result;
  }

  /** Drops light strokes that have fully faded. No undo step. Returns true if light strokes remain. */
  pruneLight(now: number, fadeMs = LIGHT_FADE_MS): boolean {
    if (!this.hasLight) return false;
    const activeStrokes = new Set<Stroke>();
    for (const a of this.actives.values())
      if (a.kind === "draw") activeStrokes.add(a.stroke);
    const next = this.strokes.filter((s) => {
      if (!s.light || activeStrokes.has(s)) return true;
      const lastT = s.points[s.points.length - 1]?.t ?? 0;
      return now - lastT < fadeMs;
    });
    if (next.length !== this.strokes.length) {
      this.strokes = next;
      this.emit();
    }
    return this.hasLight;
  }

  /** Ends every interaction in progress (mouse and all hands). */
  endAll() {
    for (const key of [...this.actives.keys()]) this.end(key);
  }

  /** Replaces the last stroke with its recognized clean shape, as its own undo step. */
  applySuggestion(): ShapeKind | null {
    const sg = this.suggestion;
    if (!sg || !this.strokes.includes(sg.stroke)) return null;
    this.suggestion = null;
    this.snapshot();
    const clean: Stroke = { ...sg.stroke, points: sg.points };
    this.strokes = this.strokes.map((s) => (s === sg.stroke ? clean : s));
    this.emit();
    return sg.kind;
  }

  dismissSuggestion() {
    if (!this.suggestion) return;
    this.suggestion = null;
    this.emit();
  }

  undo() {
    this.endAll();
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.strokes);
    this.strokes = prev;
    this.emit();
  }

  redo() {
    this.endAll();
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.strokes);
    this.strokes = next;
    this.emit();
  }

  clear() {
    this.endAll();
    if (!this.strokes.length) return;
    this.snapshot();
    this.strokes = [];
    this.emit();
  }

  /** Adds multiple strokes (e.g. from 2D AI generation) as a single undoable step. */
  addStrokes(newStrokes: Stroke[]) {
    this.endAll();
    if (!newStrokes.length) return;
    this.snapshot();
    this.strokes = [...this.strokes, ...newStrokes];
    this.emit();
  }

  /** Replaces all strokes with new strokes as a single undoable step. */
  replaceStrokes(newStrokes: Stroke[]) {
    this.endAll();
    this.snapshot();
    this.strokes = [...newStrokes];
    this.emit();
  }

  /** Replace everything (e.g. opening a saved drawing) without an undo step. */
  load(strokes: Stroke[]) {
    this.actives.clear();
    this.suggestion = null;
    this.strokes = strokes;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }
}
