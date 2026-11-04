/** A point stored in stage-relative coordinates (0..1), so drawings survive resizes. */
export type StrokePoint = {
  x: number;
  y: number;
  /** Hand depth reported by the tracker (0 for mouse/touch input). Used by the 3D view. */
  z: number;
  /** Pressure factor derived from drawing speed (slow = thicker). */
  p: number;
  /** Timestamp (performance.now) — only kept for light-painting strokes, which fade out. */
  t?: number;
};

export type BrushKind = "solid" | "rainbow" | "spray" | "dotted";

export type Stroke = {
  id: string;
  color: string;
  size: number;
  points: StrokePoint[];
  brush?: BrushKind;
  /** Light-painting stroke: fades away, never saved, not undoable. */
  light?: boolean;
};

export type Tool = "draw" | "move" | "erase";

/** Stable hand states after classification + debouncing. "erase" = index + middle up (V sign). */
export type Gesture =
  "none" | "idle" | "open" | "fist" | "point" | "pinch" | "erase";

export type Landmark = { x: number; y: number; z: number };

/** Input sample in stage pixels. */
export type InputSample = { x: number; y: number; z?: number; t: number };

export type Brush = {
  color: string;
  size: number;
  kind?: BrushKind;
  light?: boolean;
};
