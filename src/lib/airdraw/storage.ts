import { z } from "zod";

import type { Stroke, Tool } from "./types";

const KEY = "airdraw:v1";
const GALLERY_KEY = "airdraw:gallery:v1";

const pointSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  p: z.number(),
});
const strokeSchema = z.object({
  id: z.string(),
  color: z.string(),
  size: z.number(),
  points: z.array(pointSchema),
  brush: z.enum(["solid", "rainbow", "spray", "dotted"]).optional(),
});
const savedSchema = z.object({
  strokes: z.array(strokeSchema),
  settings: z
    .object({
      color: z.string(),
      size: z.number(),
      neon: z.boolean(),
      tool: z.enum(["draw", "move", "erase"]),
      multiHand: z.boolean(),
      showHands: z.boolean(),
      snapShapes: z.boolean(),
      pinchSensitivity: z.number(),
      trackingSmoothness: z.number(),
    })
    .partial()
    .optional(),
});

export type SavedSettings = {
  color: string;
  size: number;
  neon: boolean;
  tool: Tool;
  /** Track two hands, each drawing with its own color. */
  multiHand: boolean;
  /** Show the hand outline and fingertip dots over the camera. */
  showHands: boolean;
  /** Tidy recognized shapes automatically when a stroke ends. */
  snapShapes: boolean;
  /** Makes pinch gestures easier or harder to trigger. */
  pinchSensitivity: number;
  /** Smoother filter for the pointer path, useful on shaky hand tracking. */
  trackingSmoothness: number;
};
export type Saved = {
  strokes: Stroke[];
  settings?:
    { [K in keyof SavedSettings]?: SavedSettings[K] | undefined } | undefined;
};

export type GalleryEntry = {
  id: string;
  name: string;
  createdAt: number;
  dataUrl: string;
};

/** Browser only — call from effects/handlers. */
export function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = savedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function persist(data: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage full or blocked — drawing keeps working, it just isn't saved.
  }
}

export function loadGallery(): GalleryEntry[] {
  try {
    const raw = localStorage.getItem(GALLERY_KEY);
    if (!raw) return [];
    const parsed = z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          createdAt: z.number(),
          dataUrl: z.string(),
        }),
      )
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function persistGallery(entries: GalleryEntry[]) {
  try {
    localStorage.setItem(GALLERY_KEY, JSON.stringify(entries));
  } catch {
    // Ignore gallery write failures so the current app keeps working.
  }
}
