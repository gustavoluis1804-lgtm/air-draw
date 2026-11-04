import type { Stroke, StrokePoint } from "./types";

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `ai-${Date.now().toString(36)}-${idCounter}`;
}

type Point = { x: number; y: number };

function createStroke(points: Point[], color: string, size = 5): Stroke {
  return {
    id: nextId(),
    color,
    size,
    points: points.map((p, idx) => ({
      x: Math.max(0.02, Math.min(0.98, p.x)),
      y: Math.max(0.02, Math.min(0.98, p.y)),
      z: 0,
      p: 1,
      t: idx * 16,
    })),
  };
}

function sampleCurve(fn: (t: number) => Point, steps = 30): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    pts.push(fn(i / steps));
  }
  return pts;
}

function circlePoints(cx: number, cy: number, r: number, steps = 36): Point[] {
  return sampleCurve((t) => {
    const angle = t * Math.PI * 2;
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  }, steps);
}

function arcPoints(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  steps = 24,
): Point[] {
  return sampleCurve((t) => {
    const angle = start + t * (end - start);
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  }, steps);
}

function bezierPoints(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  steps = 24,
): Point[] {
  return sampleCurve((t) => {
    const mt = 1 - t;
    return {
      x:
        mt * mt * mt * p0.x +
        3 * mt * mt * t * p1.x +
        3 * mt * t * t * p2.x +
        t * t * t * p3.x,
      y:
        mt * mt * mt * p0.y +
        3 * mt * mt * t * p1.y +
        3 * mt * t * t * p2.y +
        t * t * t * p3.y,
    };
  }, steps);
}

// ----------------- LOCAL VECTOR ART TEMPLATES -----------------

function generateHeartStrokes(): Stroke[] {
  const heartOutline = sampleCurve((t) => {
    const a = t * Math.PI * 2;
    // Parametric heart formula centered at (0.5, 0.48)
    const hx = 16 * Math.pow(Math.sin(a), 3);
    const hy = -(
      13 * Math.cos(a) -
      5 * Math.cos(2 * a) -
      2 * Math.cos(3 * a) -
      Math.cos(4 * a)
    );
    return {
      x: 0.5 + (hx / 16) * 0.22,
      y: 0.48 + (hy / 16) * 0.22,
    };
  }, 48);

  const innerGlow = sampleCurve((t) => {
    const a = t * Math.PI * 2;
    const hx = 16 * Math.pow(Math.sin(a), 3);
    const hy = -(
      13 * Math.cos(a) -
      5 * Math.cos(2 * a) -
      2 * Math.cos(3 * a) -
      Math.cos(4 * a)
    );
    return {
      x: 0.5 + (hx / 16) * 0.14,
      y: 0.48 + (hy / 16) * 0.14,
    };
  }, 36);

  // Left wing
  const leftWing1 = bezierPoints(
    { x: 0.35, y: 0.45 },
    { x: 0.2, y: 0.3 },
    { x: 0.12, y: 0.4 },
    { x: 0.18, y: 0.52 },
  );
  const leftWing2 = bezierPoints(
    { x: 0.32, y: 0.5 },
    { x: 0.16, y: 0.42 },
    { x: 0.1, y: 0.55 },
    { x: 0.22, y: 0.6 },
  );

  // Right wing
  const rightWing1 = bezierPoints(
    { x: 0.65, y: 0.45 },
    { x: 0.8, y: 0.3 },
    { x: 0.88, y: 0.4 },
    { x: 0.82, y: 0.52 },
  );
  const rightWing2 = bezierPoints(
    { x: 0.68, y: 0.5 },
    { x: 0.84, y: 0.42 },
    { x: 0.9, y: 0.55 },
    { x: 0.78, y: 0.6 },
  );

  return [
    createStroke(heartOutline, "#ff0077", 6),
    createStroke(innerGlow, "#ff77aa", 4),
    createStroke(leftWing1, "#00f0ff", 4),
    createStroke(leftWing2, "#55e7ff", 3.5),
    createStroke(rightWing1, "#00f0ff", 4),
    createStroke(rightWing2, "#55e7ff", 3.5),
  ];
}

function generateCatStrokes(): Stroke[] {
  // Head
  const head = circlePoints(0.5, 0.42, 0.18, 36);
  // Left ear
  const leftEar = [
    { x: 0.38, y: 0.3 },
    { x: 0.32, y: 0.16 },
    { x: 0.45, y: 0.26 },
  ];
  // Right ear
  const rightEar = [
    { x: 0.55, y: 0.26 },
    { x: 0.68, y: 0.16 },
    { x: 0.62, y: 0.3 },
  ];
  // Eyes
  const leftEye = circlePoints(0.43, 0.4, 0.03, 16);
  const rightEye = circlePoints(0.57, 0.4, 0.03, 16);
  // Nose and mouth
  const nose = [
    { x: 0.48, y: 0.46 },
    { x: 0.52, y: 0.46 },
    { x: 0.5, y: 0.49 },
    { x: 0.48, y: 0.46 },
  ];
  const mouthLeft = arcPoints(0.47, 0.51, 0.03, 0, Math.PI);
  const mouthRight = arcPoints(0.53, 0.51, 0.03, 0, Math.PI);
  // Whiskers
  const wL1 = [
    { x: 0.38, y: 0.47 },
    { x: 0.2, y: 0.44 },
  ];
  const wL2 = [
    { x: 0.38, y: 0.5 },
    { x: 0.18, y: 0.52 },
  ];
  const wR1 = [
    { x: 0.62, y: 0.47 },
    { x: 0.8, y: 0.44 },
  ];
  const wR2 = [
    { x: 0.62, y: 0.5 },
    { x: 0.82, y: 0.52 },
  ];
  // Body and paws
  const body = bezierPoints(
    { x: 0.38, y: 0.58 },
    { x: 0.32, y: 0.78 },
    { x: 0.68, y: 0.78 },
    { x: 0.62, y: 0.58 },
  );
  // Tail
  const tail = bezierPoints(
    { x: 0.65, y: 0.76 },
    { x: 0.85, y: 0.75 },
    { x: 0.88, y: 0.6 },
    { x: 0.8, y: 0.58 },
  );

  return [
    createStroke(head, "#00f0ff", 5),
    createStroke(leftEar, "#00f0ff", 5),
    createStroke(rightEar, "#00f0ff", 5),
    createStroke(leftEye, "#ffd700", 4),
    createStroke(rightEye, "#ffd700", 4),
    createStroke(nose, "#ff0077", 4),
    createStroke(mouthLeft, "#00f0ff", 3),
    createStroke(mouthRight, "#00f0ff", 3),
    createStroke(wL1, "#ffffff", 2.5),
    createStroke(wL2, "#ffffff", 2.5),
    createStroke(wR1, "#ffffff", 2.5),
    createStroke(wR2, "#ffffff", 2.5),
    createStroke(body, "#00f0ff", 4.5),
    createStroke(tail, "#00f0ff", 4),
  ];
}

function generateSwordStrokes(): Stroke[] {
  // Blade central line
  const bladeTip = [
    { x: 0.5, y: 0.12 },
    { x: 0.5, y: 0.65 },
  ];
  // Blade left contour
  const bladeL = [
    { x: 0.5, y: 0.12 },
    { x: 0.46, y: 0.18 },
    { x: 0.47, y: 0.65 },
  ];
  // Blade right contour
  const bladeR = [
    { x: 0.5, y: 0.12 },
    { x: 0.54, y: 0.18 },
    { x: 0.53, y: 0.65 },
  ];
  // Guard
  const guard = [
    { x: 0.32, y: 0.66 },
    { x: 0.68, y: 0.66 },
    { x: 0.65, y: 0.69 },
    { x: 0.35, y: 0.69 },
    { x: 0.32, y: 0.66 },
  ];
  // Handle
  const handleL = [
    { x: 0.48, y: 0.69 },
    { x: 0.48, y: 0.82 },
  ];
  const handleR = [
    { x: 0.52, y: 0.69 },
    { x: 0.52, y: 0.82 },
  ];
  // Pommel
  const pommel = circlePoints(0.5, 0.85, 0.035, 16);
  // Energy aura runes
  const aura1 = bezierPoints(
    { x: 0.42, y: 0.3 },
    { x: 0.4, y: 0.4 },
    { x: 0.43, y: 0.5 },
    { x: 0.41, y: 0.6 },
  );
  const aura2 = bezierPoints(
    { x: 0.58, y: 0.3 },
    { x: 0.6, y: 0.4 },
    { x: 0.57, y: 0.5 },
    { x: 0.59, y: 0.6 },
  );

  return [
    createStroke(bladeTip, "#ffffff", 4),
    createStroke(bladeL, "#00f0ff", 5),
    createStroke(bladeR, "#00f0ff", 5),
    createStroke(guard, "#ffd700", 6),
    createStroke(handleL, "#ff0077", 4),
    createStroke(handleR, "#ff0077", 4),
    createStroke(pommel, "#ffd700", 5),
    createStroke(aura1, "#a855f7", 3),
    createStroke(aura2, "#a855f7", 3),
  ];
}

function generateFlowerStrokes(): Stroke[] {
  // Stem
  const stem = bezierPoints(
    { x: 0.5, y: 0.5 },
    { x: 0.52, y: 0.7 },
    { x: 0.48, y: 0.85 },
    { x: 0.5, y: 0.92 },
  );
  // Leaves
  const leafL = bezierPoints(
    { x: 0.51, y: 0.72 },
    { x: 0.38, y: 0.65 },
    { x: 0.32, y: 0.72 },
    { x: 0.5, y: 0.76 },
  );
  const leafR = bezierPoints(
    { x: 0.49, y: 0.78 },
    { x: 0.62, y: 0.72 },
    { x: 0.68, y: 0.8 },
    { x: 0.5, y: 0.83 },
  );

  // Center
  const center = circlePoints(0.5, 0.38, 0.06, 24);

  // 6 Petals around center
  const petals: Stroke[] = [];
  const petalColors = [
    "#ff0077",
    "#ff00aa",
    "#ff0077",
    "#ff00aa",
    "#ff0077",
    "#ff00aa",
  ];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const px = 0.5 + Math.cos(angle) * 0.15;
    const py = 0.38 + Math.sin(angle) * 0.15;
    const petalCircle = circlePoints(px, py, 0.075, 20);
    petals.push(createStroke(petalCircle, petalColors[i] ?? "#ff0077", 4.5));
  }

  return [
    createStroke(stem, "#10b981", 6),
    createStroke(leafL, "#10b981", 4.5),
    createStroke(leafR, "#10b981", 4.5),
    ...petals,
    createStroke(center, "#ffd700", 6),
  ];
}

function generateCarStrokes(): Stroke[] {
  // Roof, hood, trunk silhouette
  const body = bezierPoints(
    { x: 0.15, y: 0.6 },
    { x: 0.28, y: 0.52 },
    { x: 0.42, y: 0.38 },
    { x: 0.65, y: 0.38 },
  );
  const roofToBack = bezierPoints(
    { x: 0.65, y: 0.38 },
    { x: 0.78, y: 0.5 },
    { x: 0.88, y: 0.56 },
    { x: 0.9, y: 0.62 },
  );
  const underbody = [
    { x: 0.9, y: 0.62 },
    { x: 0.82, y: 0.62 },
    { x: 0.68, y: 0.62 },
    { x: 0.38, y: 0.62 },
    { x: 0.24, y: 0.62 },
    { x: 0.15, y: 0.62 },
    { x: 0.15, y: 0.6 },
  ];

  // Wheels
  const wheelFront = circlePoints(0.3, 0.62, 0.07, 24);
  const rimFront = circlePoints(0.3, 0.62, 0.035, 16);
  const wheelRear = circlePoints(0.75, 0.62, 0.07, 24);
  const rimRear = circlePoints(0.75, 0.62, 0.035, 16);

  // Window
  const windowLine = bezierPoints(
    { x: 0.44, y: 0.41 },
    { x: 0.54, y: 0.41 },
    { x: 0.63, y: 0.41 },
    { x: 0.72, y: 0.5 },
  );
  // Spoiler
  const spoiler = [
    { x: 0.85, y: 0.54 },
    { x: 0.92, y: 0.5 },
    { x: 0.93, y: 0.53 },
  ];

  return [
    createStroke(body, "#00f0ff", 5),
    createStroke(roofToBack, "#00f0ff", 5),
    createStroke(underbody, "#00f0ff", 4.5),
    createStroke(wheelFront, "#ffffff", 6),
    createStroke(rimFront, "#00f0ff", 3),
    createStroke(wheelRear, "#ffffff", 6),
    createStroke(rimRear, "#00f0ff", 3),
    createStroke(windowLine, "#55e7ff", 3.5),
    createStroke(spoiler, "#ff0077", 4),
  ];
}

function generateButterflyStrokes(): Stroke[] {
  // Body and head
  const body = bezierPoints(
    { x: 0.5, y: 0.35 },
    { x: 0.5, y: 0.45 },
    { x: 0.5, y: 0.6 },
    { x: 0.5, y: 0.7 },
  );
  const head = circlePoints(0.5, 0.32, 0.025, 14);
  // Antennae
  const antL = bezierPoints(
    { x: 0.49, y: 0.3 },
    { x: 0.44, y: 0.22 },
    { x: 0.4, y: 0.2 },
    { x: 0.38, y: 0.22 },
  );
  const antR = bezierPoints(
    { x: 0.51, y: 0.3 },
    { x: 0.56, y: 0.22 },
    { x: 0.6, y: 0.2 },
    { x: 0.62, y: 0.22 },
  );

  // Upper wings
  const wingTopL = bezierPoints(
    { x: 0.49, y: 0.4 },
    { x: 0.3, y: 0.2 },
    { x: 0.15, y: 0.32 },
    { x: 0.48, y: 0.52 },
  );
  const wingTopR = bezierPoints(
    { x: 0.51, y: 0.4 },
    { x: 0.7, y: 0.2 },
    { x: 0.85, y: 0.32 },
    { x: 0.52, y: 0.52 },
  );

  // Lower wings
  const wingBotL = bezierPoints(
    { x: 0.49, y: 0.53 },
    { x: 0.22, y: 0.58 },
    { x: 0.28, y: 0.75 },
    { x: 0.49, y: 0.65 },
  );
  const wingBotR = bezierPoints(
    { x: 0.51, y: 0.53 },
    { x: 0.78, y: 0.58 },
    { x: 0.72, y: 0.75 },
    { x: 0.51, y: 0.65 },
  );

  // Wing details
  const detailL = circlePoints(0.35, 0.38, 0.04, 16);
  const detailR = circlePoints(0.65, 0.38, 0.04, 16);

  return [
    createStroke(body, "#ffd700", 5),
    createStroke(head, "#ffd700", 4),
    createStroke(antL, "#ffffff", 2.5),
    createStroke(antR, "#ffffff", 2.5),
    createStroke(wingTopL, "#a855f7", 5),
    createStroke(wingTopR, "#a855f7", 5),
    createStroke(wingBotL, "#ff0077", 4.5),
    createStroke(wingBotR, "#ff0077", 4.5),
    createStroke(detailL, "#00f0ff", 3),
    createStroke(detailR, "#00f0ff", 3),
  ];
}

function generateRocketStrokes(): Stroke[] {
  // Fuselage body
  const bodyL = bezierPoints(
    { x: 0.5, y: 0.15 },
    { x: 0.42, y: 0.35 },
    { x: 0.42, y: 0.65 },
    { x: 0.42, y: 0.72 },
  );
  const bodyR = bezierPoints(
    { x: 0.5, y: 0.15 },
    { x: 0.58, y: 0.35 },
    { x: 0.58, y: 0.65 },
    { x: 0.58, y: 0.72 },
  );
  const base = [
    { x: 0.42, y: 0.72 },
    { x: 0.58, y: 0.72 },
  ];

  // Porthole window
  const window = circlePoints(0.5, 0.42, 0.05, 20);

  // Fins
  const finL = [
    { x: 0.42, y: 0.58 },
    { x: 0.28, y: 0.76 },
    { x: 0.42, y: 0.72 },
  ];
  const finR = [
    { x: 0.58, y: 0.58 },
    { x: 0.72, y: 0.76 },
    { x: 0.58, y: 0.72 },
  ];

  // Exhaust flame
  const flameOuter = bezierPoints(
    { x: 0.44, y: 0.72 },
    { x: 0.4, y: 0.88 },
    { x: 0.5, y: 0.95 },
    { x: 0.56, y: 0.72 },
  );
  const flameInner = bezierPoints(
    { x: 0.47, y: 0.72 },
    { x: 0.45, y: 0.84 },
    { x: 0.5, y: 0.88 },
    { x: 0.53, y: 0.72 },
  );

  return [
    createStroke(bodyL, "#ffffff", 5),
    createStroke(bodyR, "#ffffff", 5),
    createStroke(base, "#ffffff", 4),
    createStroke(window, "#00f0ff", 4.5),
    createStroke(finL, "#ff0077", 4.5),
    createStroke(finR, "#ff0077", 4.5),
    createStroke(flameOuter, "#ff5500", 5),
    createStroke(flameInner, "#ffd700", 3.5),
  ];
}

function generateStarStrokes(): Stroke[] {
  // 5-pointed star
  const starPts: Point[] = [];
  const outerR = 0.26;
  const innerR = 0.11;
  const cx = 0.5;
  const cy = 0.48;
  for (let i = 0; i <= 10; i++) {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    starPts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }

  // Orbiting cosmic rings
  const orbit1 = circlePoints(cx, cy, 0.32, 40);
  const orbit2 = circlePoints(cx, cy, 0.38, 40);

  // Sparkles
  const sp1 = [
    { x: 0.22, y: 0.22 },
    { x: 0.28, y: 0.28 },
  ];
  const sp2 = [
    { x: 0.28, y: 0.22 },
    { x: 0.22, y: 0.28 },
  ];
  const sp3 = [
    { x: 0.72, y: 0.68 },
    { x: 0.78, y: 0.74 },
  ];
  const sp4 = [
    { x: 0.78, y: 0.68 },
    { x: 0.72, y: 0.74 },
  ];

  return [
    createStroke(starPts, "#ffd700", 6),
    createStroke(orbit1, "#00f0ff", 3),
    createStroke(orbit2, "#a855f7", 2.5),
    createStroke(sp1, "#ffffff", 3),
    createStroke(sp2, "#ffffff", 3),
    createStroke(sp3, "#ffffff", 3),
    createStroke(sp4, "#ffffff", 3),
  ];
}

function generateDragonStrokes(): Stroke[] {
  // S-curved serpentine body
  const body = bezierPoints(
    { x: 0.2, y: 0.6 },
    { x: 0.35, y: 0.25 },
    { x: 0.65, y: 0.7 },
    { x: 0.8, y: 0.35 },
  );
  // Head
  const head = [
    { x: 0.76, y: 0.38 },
    { x: 0.86, y: 0.3 },
    { x: 0.88, y: 0.36 },
    { x: 0.82, y: 0.42 },
  ];
  // Horns
  const horn = [
    { x: 0.82, y: 0.32 },
    { x: 0.88, y: 0.2 },
  ];
  // Dragon eye
  const eye = circlePoints(0.83, 0.34, 0.015, 8);
  // Wings
  const wingL = bezierPoints(
    { x: 0.5, y: 0.45 },
    { x: 0.35, y: 0.2 },
    { x: 0.5, y: 0.15 },
    { x: 0.55, y: 0.38 },
  );
  const wingR = bezierPoints(
    { x: 0.55, y: 0.38 },
    { x: 0.65, y: 0.15 },
    { x: 0.75, y: 0.25 },
    { x: 0.62, y: 0.45 },
  );
  // Fire breath
  const fire1 = bezierPoints(
    { x: 0.88, y: 0.36 },
    { x: 0.94, y: 0.38 },
    { x: 0.96, y: 0.46 },
    { x: 0.9, y: 0.48 },
  );

  return [
    createStroke(body, "#00f0ff", 6),
    createStroke(head, "#00f0ff", 5),
    createStroke(horn, "#ffd700", 4),
    createStroke(eye, "#ffd700", 3),
    createStroke(wingL, "#a855f7", 4.5),
    createStroke(wingR, "#a855f7", 4.5),
    createStroke(fire1, "#ff0055", 4),
  ];
}

function generateMandalaStrokes(): Stroke[] {
  const strokes: Stroke[] = [];
  const cx = 0.5;
  const cy = 0.5;

  // Concentric rings
  strokes.push(createStroke(circlePoints(cx, cy, 0.08, 24), "#ffd700", 4));
  strokes.push(createStroke(circlePoints(cx, cy, 0.18, 36), "#00f0ff", 4));
  strokes.push(createStroke(circlePoints(cx, cy, 0.32, 48), "#a855f7", 3.5));

  // 8 Flower of life petals
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const px = cx + Math.cos(angle) * 0.18;
    const py = cy + Math.sin(angle) * 0.18;
    strokes.push(
      createStroke(
        circlePoints(px, py, 0.12, 24),
        i % 2 === 0 ? "#ff0077" : "#00f0ff",
        3,
      ),
    );
  }

  return strokes;
}

// ----------------- MAIN DISPATCHER -----------------

export async function generate2DDrawing(
  prompt: string,
): Promise<{ strokes: Stroke[]; title: string; source: "local" }> {
  const query = prompt.trim().toLowerCase();

  // 2. Intelligent local vector art fallback (100% reliable, zero dependencies)
  if (/(gato|gatinho|cat|kitten|felino|miau)/i.test(query)) {
    return {
      strokes: generateCatStrokes(),
      title: "Gatinho Neon",
      source: "local",
    };
  }
  if (/(coracao|coração|heart|amor|love|paixao|paixão)/i.test(query)) {
    return {
      strokes: generateHeartStrokes(),
      title: "Coração com Asas",
      source: "local",
    };
  }
  if (/(dragao|dragão|dragon|monstro|reptil)/i.test(query)) {
    return {
      strokes: generateDragonStrokes(),
      title: "Dragão Cyberpunk",
      source: "local",
    };
  }
  if (/(espada|sword|lamina|lâmina|adaga|katana|sabre)/i.test(query)) {
    return {
      strokes: generateSwordStrokes(),
      title: "Espada Futurista",
      source: "local",
    };
  }
  if (/(flor|flower|rosa|rose|girassol|tulipa|planta|jardim)/i.test(query)) {
    return {
      strokes: generateFlowerStrokes(),
      title: "Flor Radiante",
      source: "local",
    };
  }
  if (/(carro|car|automovel|automóvel|veiculo|veículo|corrida)/i.test(query)) {
    return {
      strokes: generateCarStrokes(),
      title: "Carro Esportivo",
      source: "local",
    };
  }
  if (/(borboleta|butterfly|mariposa)/i.test(query)) {
    return {
      strokes: generateButterflyStrokes(),
      title: "Borboleta Neon",
      source: "local",
    };
  }
  if (/(foguete|rocket|espaco|espaço|nave|astronave|cosmos)/i.test(query)) {
    return {
      strokes: generateRocketStrokes(),
      title: "Foguete Espacial",
      source: "local",
    };
  }
  if (
    /(estrela|star|constelacao|constelação|astro|galaxia|galáxia)/i.test(query)
  ) {
    return {
      strokes: generateStarStrokes(),
      title: "Estrela Cósmica",
      source: "local",
    };
  }

  // Default: Mandala Geométrica
  return {
    strokes: generateMandalaStrokes(),
    title: "Mandala Neon",
    source: "local",
  };
}
