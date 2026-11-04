import { recognizeShape, SHAPE_LABEL } from "./shapes";

export type AiSuggestion = {
  label: string;
  confidence: number;
};

export function recognizeAiGlyph(
  points: { x: number; y: number }[],
): AiSuggestion | null {
  if (points.length < 8) return null;

  const shape = recognizeShape(points);
  if (!shape) return null;

  return {
    label: SHAPE_LABEL[shape.kind],
    confidence: 0.94,
  };
}
