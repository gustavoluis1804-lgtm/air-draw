import { describe, expect, it } from "vitest";

import { generate2DDrawing } from "./ai-generator";
import { DrawingEngine } from "./engine";

describe("2D AI Drawing Generator", () => {
  it("generates cat strokes from prompt", async () => {
    const res = await generate2DDrawing("desenhe um gato fofo");
    expect(res.strokes.length).toBeGreaterThan(5);
    expect(res.title).toContain("Gatinho");
    res.strokes.forEach((s) => {
      expect(s.color).toBeDefined();
      expect(s.points.length).toBeGreaterThan(0);
      s.points.forEach((p) => {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      });
    });
  });

  it("generates heart strokes from prompt", async () => {
    const res = await generate2DDrawing("coração com asas");
    expect(res.strokes.length).toBeGreaterThan(3);
    expect(res.title).toContain("Coração");
  });

  it("generates sword strokes from prompt", async () => {
    const res = await generate2DDrawing("espada laser neon");
    expect(res.strokes.length).toBeGreaterThan(3);
    expect(res.title).toContain("Espada");
  });

  it("generates flower strokes from prompt", async () => {
    const res = await generate2DDrawing("uma flor radiante");
    expect(res.strokes.length).toBeGreaterThan(5);
    expect(res.title).toContain("Flor");
  });

  it("generates car strokes from prompt", async () => {
    const res = await generate2DDrawing("carro esportivo veloz");
    expect(res.strokes.length).toBeGreaterThan(4);
    expect(res.title).toContain("Carro");
  });

  it("generates rocket strokes from prompt", async () => {
    const res = await generate2DDrawing("foguete espacial na lua");
    expect(res.strokes.length).toBeGreaterThan(4);
    expect(res.title).toContain("Foguete");
  });

  it("integrates with DrawingEngine and is completely undoable", async () => {
    const engine = new DrawingEngine();
    engine.setViewport(800, 600);
    expect(engine.strokes).toHaveLength(0);

    const res = await generate2DDrawing("borboleta colorida");
    engine.addStrokes(res.strokes);
    expect(engine.strokes.length).toBe(res.strokes.length);
    expect(engine.canUndo).toBe(true);

    engine.undo();
    expect(engine.strokes).toHaveLength(0);

    engine.redo();
    expect(engine.strokes.length).toBe(res.strokes.length);
  });
});
