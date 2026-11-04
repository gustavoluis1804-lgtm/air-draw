import {
  Boxes,
  CircleDot,
  Compass,
  Download,
  Eye,
  Hand,
  ImageDown,
  RotateCcw,
  View,
  Waves,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { downloadBlob } from "@/lib/airdraw/download";
import { clamp } from "@/lib/airdraw/geometry";
import { cssColorToHex, readCssVar } from "@/lib/airdraw/render";
import type { Stroke } from "@/lib/airdraw/types";
import { cn } from "@/lib/utils";

type GeometryMode = "inflate" | "lathe" | "extrude" | "tubes";
type MaterialVariant =
  | "neon"
  | "gold"
  | "chrome"
  | "glass"
  | "crystal"
  | "clay"
  | "hologram"
  | "ruby"
  | "obsidian";

type StrokeAnalysis = {
  pointsCount: number;
  strokeCount: number;
  aspect: number;
  isSymmetric: boolean;
  isClosed: boolean;
};

/** Lets the drawing screen turn the model with an open hand gesture. */
export type Scene3DHandle = {
  /** Orbit the camera by these angles (radians). */
  rotateBy: (dTheta: number, dPhi: number) => void;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  strokes: Stroke[];
  aspect: number;
  stageHeight: number;
  previewImage?: string | null;
  handleRef?: RefObject<Scene3DHandle | null>;
};

/** World units that correspond to the full stage height. */
const UNIT = 200;
const CAMERA_HOME = new THREE.Vector3(0, 35, 330);

const MODES: Array<{
  id: GeometryMode;
  label: string;
  icon: string;
  desc: string;
}> = [
  {
    id: "inflate",
    label: "Inflado 3D",
    icon: "🎈",
    desc: "Volume orgânico suave em domo 360°",
  },
  {
    id: "lathe",
    label: "Torno / Revolução",
    icon: "🔄",
    desc: "Sólido oco com espessura para taças e vasos",
  },
  {
    id: "extrude",
    label: "Extrusão Sólida",
    icon: "📦",
    desc: "Sólido com chanfros para espadas e símbolos",
  },
  {
    id: "tubes",
    label: "Tubos Dinâmicos",
    icon: "〰️",
    desc: "Tubos com espessura variável e brilho neon",
  },
];

const MATERIALS: Array<{ id: MaterialVariant; label: string; dot: string }> = [
  { id: "neon", label: "Neon", dot: "#00f0ff" },
  { id: "gold", label: "Ouro", dot: "#ffd700" },
  { id: "chrome", label: "Cromo", dot: "#e2e8f0" },
  { id: "glass", label: "Vidro", dot: "#93c5fd" },
  { id: "crystal", label: "Cristal", dot: "#c4b5fd" },
  { id: "clay", label: "Argila", dot: "#d97706" },
  { id: "hologram", label: "Holograma", dot: "#a855f7" },
  { id: "ruby", label: "Rubi", dot: "#e11d48" },
  { id: "obsidian", label: "Obsidiana", dot: "#334155" },
];

function analyzeStrokes(strokes: Stroke[], aspect: number): StrokeAnalysis {
  let pointsCount = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let isClosed = false;

  for (const s of strokes) {
    pointsCount += s.points.length;
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (s.points.length >= 8) {
      const first = s.points[0]!;
      const last = s.points[s.points.length - 1]!;
      const dist = Math.hypot((first.x - last.x) * aspect, first.y - last.y);
      if (dist < 0.12) isClosed = true;
    }
  }

  const w = maxX > minX ? maxX - minX : 1;
  const h = maxY > minY ? maxY - minY : 1;
  const strokeAspect = (w * aspect) / Math.max(h, 0.01);

  const cx = (minX + maxX) / 2;
  let left = 0;
  let right = 0;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < cx) left++;
      else right++;
    }
  }
  const isSymmetric = Math.min(left, right) / Math.max(left, right, 1) > 0.62;

  return {
    pointsCount,
    strokeCount: strokes.length,
    aspect: strokeAspect,
    isSymmetric,
    isClosed,
  };
}

function createPbrMaterial(
  variant: MaterialVariant,
  baseColor: THREE.Color,
  wireframe = false,
): THREE.Material {
  switch (variant) {
    case "neon":
      return new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: baseColor,
        emissiveIntensity: 1.1,
        roughness: 0.14,
        metalness: 0.1,
        wireframe,
      });
    case "gold":
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color("#ffc83b"),
        emissive: new THREE.Color("#4a2800"),
        emissiveIntensity: 0.2,
        roughness: 0.12,
        metalness: 0.98,
        wireframe,
      });
    case "chrome":
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color("#f1f5f9"),
        emissive: new THREE.Color("#0f172a"),
        emissiveIntensity: 0.05,
        roughness: 0.04,
        metalness: 1.0,
        wireframe,
      });
    case "glass":
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#f8fafc"),
        emissive: baseColor,
        emissiveIntensity: 0.15,
        roughness: 0.03,
        metalness: 0.05,
        transmission: 0.88,
        transparent: true,
        opacity: 0.82,
        ior: 1.52,
        wireframe,
      });
    case "crystal":
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#e0f2fe"),
        emissive: baseColor,
        emissiveIntensity: 0.35,
        roughness: 0.02,
        metalness: 0.1,
        transmission: 0.92,
        transparent: true,
        opacity: 0.9,
        ior: 1.82,
        wireframe,
      });
    case "clay":
      return new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.92,
        metalness: 0.02,
        emissive: new THREE.Color("#111111"),
        emissiveIntensity: 0.04,
        wireframe,
      });
    case "hologram":
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color("#38bdf8"),
        emissive: new THREE.Color("#818cf8"),
        emissiveIntensity: 1.4,
        roughness: 0.2,
        metalness: 0.3,
        transparent: true,
        opacity: 0.8,
        wireframe: true,
      });
    case "ruby":
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#e11d48"),
        emissive: new THREE.Color("#881337"),
        emissiveIntensity: 0.45,
        roughness: 0.05,
        metalness: 0.15,
        transmission: 0.75,
        transparent: true,
        opacity: 0.88,
        ior: 1.77,
        wireframe,
      });
    case "obsidian":
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color("#090d16"),
        emissive: new THREE.Color("#020617"),
        emissiveIntensity: 0.08,
        roughness: 0.06,
        metalness: 0.92,
        wireframe,
      });
    default:
      return new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: baseColor,
        emissiveIntensity: 0.8,
        roughness: 0.2,
        metalness: 0.1,
        wireframe,
      });
  }
}

type SceneApi = {
  rebuild: (
    depth: number,
    mode?: GeometryMode,
    material?: MaterialVariant,
  ) => void;
  reset: () => void;
  setView: (view: "perspective" | "front" | "top" | "side") => void;
  setAutoRotate: (on: boolean) => void;
  exportGlb: () => void;
  exportPng: () => void;
};

export default function Scene3D({
  open,
  onOpenChange,
  strokes,
  aspect,
  stageHeight,
  previewImage,
  handleRef,
}: Props) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [depth, setDepth] = useState(1.4);
  const [inflation, setInflation] = useState(1.2);
  const [mode, setMode] = useState<GeometryMode>("inflate");
  const [material, setMaterial] = useState<MaterialVariant>("neon");
  const [autoRotate, setAutoRotate] = useState(true);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showParticles, setShowParticles] = useState(true);

  const apiRef = useRef<SceneApi | null>(null);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const materialRef = useRef(material);
  materialRef.current = material;
  const wireframeRef = useRef(showWireframe);
  wireframeRef.current = showWireframe;

  useEffect(() => {
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    // Studio Environment Reflections using RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const envScene = new RoomEnvironment();
    const envTexture = pmremGenerator.fromScene(envScene).texture;
    scene.environment = envTexture;

    const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    camera.position.copy(CAMERA_HOME);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;
    controls.minDistance = 50;
    controls.maxDistance = 1200;
    const stopAuto = () => {
      controls.autoRotate = false;
      setAutoRotate(false);
    };
    controls.addEventListener("start", stopAuto);

    const lightA = new THREE.Color(
      cssColorToHex(readCssVar("--scene-light-a") || "#55e7ff"),
    );
    const lightB = new THREE.Color(
      cssColorToHex(readCssVar("--scene-light-b") || "#ff6687"),
    );

    scene.add(new THREE.HemisphereLight(0xffffff, lightB, 0.7));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(160, 240, 240);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 20;
    keyLight.shadow.camera.far = 800;
    keyLight.shadow.bias = -0.0004;
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(lightA, 2.0, 0, 0);
    rimLight.position.set(-220, -40, 160);
    scene.add(rimLight);

    const backLight = new THREE.PointLight(lightB, 1.5, 0, 0);
    backLight.position.set(200, 90, -220);
    scene.add(backLight);

    const grid = new THREE.GridHelper(
      600,
      30,
      new THREE.Color(
        cssColorToHex(readCssVar("--scene-grid-center") || "#3a4560"),
      ),
      new THREE.Color(cssColorToHex(readCssVar("--scene-grid") || "#252d40")),
    );
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.45;
    scene.add(grid);

    // Floor shadow catcher
    const shadowGeo = new THREE.PlaneGeometry(600, 600);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    // Ambient floating 3D dust particles
    const particleCount = 140;
    const pGeo = new THREE.BufferGeometry();
    const posArray = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      posArray[i] = (Math.random() - 0.5) * 520;
      posArray[i + 1] = (Math.random() - 0.5) * 520;
      posArray[i + 2] = (Math.random() - 0.5) * 520;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(posArray, 3));
    const pMat = new THREE.PointsMaterial({
      size: 2.4,
      color: lightA,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });
    const ambientParticles = new THREE.Points(pGeo, pMat);
    scene.add(ambientParticles);

    // Pedestal group
    const pedestalGroup = new THREE.Group();
    scene.add(pedestalGroup);

    // The core 3D model group (cleanly exported to .glb)
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    const home = {
      center: new THREE.Vector3(),
      distance: CAMERA_HOME.length(),
    };

    const disposeGroup = (grp: THREE.Group) => {
      for (const child of [...grp.children]) {
        grp.remove(child);
        child.traverse((o) => {
          const mesh = o as THREE.Mesh;
          mesh.geometry?.dispose();
          const m = mesh.material as
            THREE.Material | THREE.Material[] | undefined;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m?.dispose();
        });
      }
    };

    const rebuild = (
      depthFactor: number,
      nextMode = modeRef.current,
      nextMaterial = materialRef.current,
    ) => {
      disposeGroup(modelGroup);
      disposeGroup(pedestalGroup);

      const n = strokes.length;
      if (n === 0) return;

      const materialVariant = nextMaterial;
      const rotationX = 12;
      const rotationY = -18;
      const inflationFactor = inflation;
      const isWire = wireframeRef.current;

      modelGroup.rotation.set(
        (rotationX * Math.PI) / 180,
        (rotationY * Math.PI) / 180,
        0,
      );

      // 1. Calculate overall drawing bounds
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      strokes.forEach((s) => {
        s.points.forEach((p) => {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
      });

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const spanX = Math.max(0.01, maxX - minX);
      const spanY = Math.max(0.01, maxY - minY);
      const primaryColor = new THREE.Color(strokes[0]?.color ?? "#00f0ff");

      // MODE 1: LATHE (Double-walled 360° Revolved 3D Solid)
      if (nextMode === "lathe") {
        const slices = 36;
        const minYWorld = -(maxY - 0.5) * UNIT;
        const maxYWorld = -(minY - 0.5) * UNIT;
        const heightRange = Math.max(1, maxYWorld - minYWorld);

        const bins: Array<{ sumR: number; count: number; y: number }> =
          Array.from({ length: slices }, (_, k) => ({
            sumR: 0,
            count: 0,
            y: minYWorld + (k / (slices - 1)) * heightRange,
          }));

        strokes.forEach((s) => {
          s.points.forEach((p) => {
            const r = Math.abs((p.x - centerX) * aspect * UNIT);
            const y = -(p.y - 0.5) * UNIT;
            const idx = Math.min(
              slices - 1,
              Math.max(
                0,
                Math.floor(((y - minYWorld) / heightRange) * (slices - 1)),
              ),
            );
            bins[idx]!.sumR += r;
            bins[idx]!.count++;
          });
        });

        const outerProfile: THREE.Vector2[] = [];
        let lastR = 12 * depthFactor;
        for (let k = 0; k < slices; k++) {
          const b = bins[k]!;
          const r = b.count > 0 ? (b.sumR / b.count) * depthFactor : lastR;
          lastR = Math.max(4, r);
          outerProfile.push(new THREE.Vector2(lastR, b.y));
        }

        // Build double-walled profile (outer wall + lip + inner hollow wall + bottom base)
        const wallThickness = 3.5 * depthFactor;
        const fullProfile: THREE.Vector2[] = [];

        // Bottom center start
        fullProfile.push(new THREE.Vector2(0, outerProfile[0]!.y));

        // Outer wall going UP
        outerProfile.forEach((pt) => fullProfile.push(pt));

        // Top rim rounded lip
        const topOuter = outerProfile[outerProfile.length - 1]!;
        fullProfile.push(
          new THREE.Vector2(
            Math.max(2, topOuter.x - wallThickness * 0.5),
            topOuter.y + 1,
          ),
        );

        // Inner wall going DOWN
        for (let k = outerProfile.length - 1; k >= 0; k--) {
          const pt = outerProfile[k]!;
          const innerR = Math.max(1.5, pt.x - wallThickness);
          fullProfile.push(
            new THREE.Vector2(
              innerR,
              pt.y + (k === 0 ? wallThickness * 0.8 : 0),
            ),
          );
        }

        // Inner bottom center closure
        fullProfile.push(
          new THREE.Vector2(0, outerProfile[0]!.y + wallThickness * 0.8),
        );

        const latheMat = createPbrMaterial(
          materialVariant,
          primaryColor,
          isWire,
        );
        const latheGeo = new THREE.LatheGeometry(
          fullProfile,
          52,
          0,
          Math.PI * 2,
        );
        latheGeo.computeVertexNormals();
        const latheMesh = new THREE.Mesh(latheGeo, latheMat);
        latheMesh.castShadow = true;
        latheMesh.receiveShadow = true;
        latheMesh.name = "lathe-body";
        modelGroup.add(latheMesh);

        // Decorative contour glowing tubes
        strokes.forEach((s) => {
          if (s.points.length < 2) return;
          const pts: THREE.Vector3[] = [];
          for (
            let j = 0;
            j < s.points.length;
            j += Math.max(1, Math.floor(s.points.length / 120))
          ) {
            const p = s.points[j]!;
            pts.push(
              new THREE.Vector3(
                (p.x - 0.5) * aspect * UNIT,
                -(p.y - 0.5) * UNIT,
                15 * depthFactor,
              ),
            );
          }
          const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
          const tubeGeo = new THREE.TubeGeometry(
            curve,
            pts.length * 2,
            1.2,
            8,
            false,
          );
          const tubeMat = createPbrMaterial(
            "neon",
            new THREE.Color(s.color),
            isWire,
          );
          const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
          tubeMesh.castShadow = true;
          modelGroup.add(tubeMesh);
        });
      }
      // MODE 2: EXTRUSION (Solid 3D Extrusion with Chamfers and Bevels)
      else if (nextMode === "extrude") {
        strokes.forEach((s, i) => {
          if (s.points.length < 3) return;
          const first = s.points[0]!;
          const last = s.points[s.points.length - 1]!;
          const isClosed =
            Math.hypot((first.x - last.x) * aspect, first.y - last.y) < 0.18;

          if (isClosed) {
            const shape = new THREE.Shape();
            shape.moveTo(
              (first.x - 0.5) * aspect * UNIT,
              -(first.y - 0.5) * UNIT,
            );
            for (let j = 1; j < s.points.length; j++) {
              const p = s.points[j]!;
              shape.lineTo((p.x - 0.5) * aspect * UNIT, -(p.y - 0.5) * UNIT);
            }
            shape.closePath();

            const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
              depth: 26 * depthFactor,
              bevelEnabled: true,
              bevelThickness: 4 * depthFactor,
              bevelSize: 2.8,
              bevelSegments: 4,
            });
            extrudeGeo.center();
            const mat = createPbrMaterial(
              materialVariant,
              new THREE.Color(s.color),
              isWire,
            );
            const mesh = new THREE.Mesh(extrudeGeo, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.position.z = (i - (n - 1) / 2) * 8 * depthFactor;
            modelGroup.add(mesh);
          } else {
            // Open stroke: volumetric extruded beam
            const pts: THREE.Vector3[] = [];
            for (
              let j = 0;
              j < s.points.length;
              j += Math.max(1, Math.floor(s.points.length / 160))
            ) {
              const p = s.points[j]!;
              pts.push(
                new THREE.Vector3(
                  (p.x - 0.5) * aspect * UNIT,
                  -(p.y - 0.5) * UNIT,
                  0,
                ),
              );
            }
            const radius = Math.max(
              1.4,
              ((s.size / 2) * UNIT) / Math.max(stageHeight, 1),
            );
            const mat = createPbrMaterial(
              materialVariant,
              new THREE.Color(s.color),
              isWire,
            );

            [-14 * depthFactor, 14 * depthFactor].forEach((zOff) => {
              const shifted = pts.map((v) => new THREE.Vector3(v.x, v.y, zOff));
              const curve = new THREE.CatmullRomCurve3(
                shifted,
                false,
                "centripetal",
              );
              const tube = new THREE.TubeGeometry(
                curve,
                shifted.length * 2,
                radius,
                12,
                false,
              );
              const m = new THREE.Mesh(tube, mat);
              m.castShadow = true;
              modelGroup.add(m);
            });
          }
        });
      }
      // MODE 3: INFLATE & TUBES (Volumetric 3D Sculpted Cushion with Modulated Radius)
      else {
        strokes.forEach((s, i) => {
          if (!s.points.length) return;
          const meanZ = s.points.reduce((a, p) => a + p.z, 0) / s.points.length;
          const layer = (i - (n - 1) / 2) * 8 * depthFactor;
          const step = Math.max(1, Math.floor(s.points.length / 220));

          const vecsFront: THREE.Vector3[] = [];
          const vecsBack: THREE.Vector3[] = [];

          for (let j = 0; j < s.points.length; j += step) {
            const p = s.points[j]!;
            const dist =
              Math.hypot((p.x - centerX) / spanX, (p.y - centerY) / spanY) * 2;
            const bulge =
              nextMode === "inflate"
                ? Math.sqrt(Math.max(0, 1.2 - Math.min(1.2, dist * dist))) *
                  34 *
                  depthFactor *
                  inflationFactor
                : 0;

            const t = j / Math.max(1, s.points.length - 1);
            const arch =
              mode === "inflate" ? Math.sin(t * Math.PI) * 18 * depthFactor : 0;
            const handZ = clamp(-(p.z - meanZ) * 800, -60, 60) * depthFactor;

            const zF = layer + bulge + arch + handZ;
            const zB = layer - (bulge + arch) - handZ;

            vecsFront.push(
              new THREE.Vector3(
                (p.x - 0.5) * aspect * UNIT,
                -(p.y - 0.5) * UNIT,
                zF,
              ),
            );
            if (mode === "inflate") {
              vecsBack.push(
                new THREE.Vector3(
                  (p.x - 0.5) * aspect * UNIT,
                  -(p.y - 0.5) * UNIT,
                  zB,
                ),
              );
            }
          }

          const baseRadius = Math.max(
            1.0,
            ((s.size / 2) * UNIT) / Math.max(stageHeight, 1),
          );
          const mat = createPbrMaterial(
            materialVariant,
            new THREE.Color(s.color),
            isWire,
          );

          const strokeGroup = new THREE.Group();
          strokeGroup.name = `stroke-${i + 1}`;

          // Front tube
          if (vecsFront.length < 2) {
            const dot = new THREE.Mesh(
              new THREE.SphereGeometry(baseRadius * 1.4, 16, 14),
              mat,
            );
            dot.castShadow = true;
            dot.position.copy(vecsFront[0] ?? new THREE.Vector3());
            strokeGroup.add(dot);
          } else {
            const curveF = new THREE.CatmullRomCurve3(
              vecsFront,
              false,
              "centripetal",
            );
            const tubeF = new THREE.TubeGeometry(
              curveF,
              Math.min(700, vecsFront.length * 3),
              baseRadius * (mode === "inflate" ? 1.2 : 1.0),
              14,
              false,
            );
            const meshF = new THREE.Mesh(tubeF, mat);
            meshF.castShadow = true;
            meshF.receiveShadow = true;
            strokeGroup.add(meshF);

            for (const end of [
              vecsFront[0]!,
              vecsFront[vecsFront.length - 1]!,
            ]) {
              const cap = new THREE.Mesh(
                new THREE.SphereGeometry(baseRadius * 1.2, 16, 12),
                mat,
              );
              cap.castShadow = true;
              cap.position.copy(end);
              strokeGroup.add(cap);
            }

            // Back shell for full 360° double-sided volume
            if (vecsBack.length >= 2 && mode === "inflate") {
              const curveB = new THREE.CatmullRomCurve3(
                vecsBack,
                false,
                "centripetal",
              );
              const tubeB = new THREE.TubeGeometry(
                curveB,
                Math.min(700, vecsBack.length * 3),
                baseRadius * 1.15,
                14,
                false,
              );
              const meshB = new THREE.Mesh(tubeB, mat);
              meshB.castShadow = true;
              meshB.receiveShadow = true;
              strokeGroup.add(meshB);

              for (const end of [
                vecsBack[0]!,
                vecsBack[vecsBack.length - 1]!,
              ]) {
                const cap = new THREE.Mesh(
                  new THREE.SphereGeometry(baseRadius * 1.15, 16, 12),
                  mat,
                );
                cap.castShadow = true;
                cap.position.copy(end);
                strokeGroup.add(cap);
              }
            }
          }

          modelGroup.add(strokeGroup);
        });
      }

      // Calculate bounding box and floor
      const box = new THREE.Box3().setFromObject(modelGroup);
      const floorY = Number.isFinite(box.min.y) ? box.min.y - 20 : -130;
      grid.position.y = floorY;
      shadowPlane.position.y = floorY + 0.1;

      // Holographic Pedestal
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const ringRadius = Math.max(45, Math.hypot(size.x, size.z) * 0.68);

        // Outer glow ring
        const ringGeo = new THREE.RingGeometry(
          ringRadius * 0.9,
          ringRadius,
          64,
        );
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: lightA,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.5,
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(center.x, floorY + 0.6, center.z);
        pedestalGroup.add(ringMesh);

        // Inner glowing accent ring
        const innerRingGeo = new THREE.RingGeometry(
          ringRadius * 0.55,
          ringRadius * 0.58,
          48,
        );
        innerRingGeo.rotateX(-Math.PI / 2);
        const innerRingMat = new THREE.MeshBasicMaterial({
          color: lightB,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.4,
        });
        const innerRingMesh = new THREE.Mesh(innerRingGeo, innerRingMat);
        innerRingMesh.position.set(center.x, floorY + 0.7, center.z);
        pedestalGroup.add(innerRingMesh);

        // Ground disc
        const discGeo = new THREE.CircleGeometry(ringRadius * 0.88, 48);
        discGeo.rotateX(-Math.PI / 2);
        const discMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(
            cssColorToHex(readCssVar("--canvas-bg") || "#0b0f17"),
          ),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.65,
        });
        const discMesh = new THREE.Mesh(discGeo, discMat);
        discMesh.position.set(center.x, floorY + 0.4, center.z);
        pedestalGroup.add(discMesh);
      }

      if (!box.isEmpty()) {
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const fov = (camera.fov * Math.PI) / 180;
        const fitH = sphere.radius / Math.sin(fov / 2);
        const fitW = fitH / Math.min(1, camera.aspect);
        home.center.copy(sphere.center);
        home.distance = Math.max(120, Math.max(fitH, fitW) * 1.08);
      }

      ambientParticles.visible = showParticles;

      keyLight.intensity = 2.9;
      rimLight.intensity = 2.0;
      backLight.intensity = 1.6;
    };

    const goHome = () => {
      const dir = CAMERA_HOME.clone().normalize();
      controls.target.copy(home.center);
      camera.position.copy(home.center).addScaledVector(dir, home.distance);
      controls.update();
    };

    const setView = (view: "perspective" | "front" | "top" | "side") => {
      controls.autoRotate = false;
      setAutoRotate(false);
      controls.target.copy(home.center);
      const d = home.distance;
      if (view === "front") {
        camera.position.set(home.center.x, home.center.y, home.center.z + d);
      } else if (view === "top") {
        camera.position.set(
          home.center.x,
          home.center.y + d,
          home.center.z + 0.01,
        );
      } else if (view === "side") {
        camera.position.set(home.center.x + d, home.center.y, home.center.z);
      } else {
        const dir = CAMERA_HOME.clone().normalize();
        camera.position.copy(home.center).addScaledVector(dir, d);
      }
      camera.lookAt(home.center);
      controls.update();
    };

    const rotateBy = (dTheta: number, dPhi: number) => {
      if (controls.autoRotate) stopAuto();
      const offset = new THREE.Vector3()
        .copy(camera.position)
        .sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      sph.theta -= dTheta;
      sph.phi = clamp(sph.phi - dPhi, 0.15, Math.PI - 0.15);
      offset.setFromSpherical(sph);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
    };

    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    rebuild(depthRef.current);
    goHome();

    renderer.setAnimationLoop(() => {
      controls.update();
      if (ambientParticles.visible) {
        ambientParticles.rotation.y += 0.0012;
        ambientParticles.rotation.x += 0.0006;
      }
      renderer.render(scene, camera);
    });

    if (handleRef) {
      handleRef.current = { rotateBy };
    }

    apiRef.current = {
      rebuild: (
        nextDepth,
        nextMode = modeRef.current,
        nextMaterial = materialRef.current,
      ) => {
        rebuild(nextDepth, nextMode, nextMaterial);
      },
      reset: goHome,
      setView,
      setAutoRotate: (on) => {
        controls.autoRotate = on;
      },
      exportGlb: () => {
        new GLTFExporter().parse(
          modelGroup,
          (result) => {
            downloadBlob(
              new Blob([result as ArrayBuffer], { type: "model/gltf-binary" }),
              "airdraw.glb",
            );
            toast.success("Modelo 3D exportado com sucesso (.glb)");
          },
          () => toast.error("Não foi possível exportar o modelo 3D."),
          { binary: true },
        );
      },
      exportPng: () => {
        const prev = scene.background;
        scene.background = new THREE.Color(
          cssColorToHex(readCssVar("--canvas-bg") || "#0b0f17"),
        );
        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL("image/png");
        scene.background = prev;
        void fetch(url)
          .then((r) => r.blob())
          .then((blob) => {
            downloadBlob(blob, "airdraw-3d.png");
            toast.success("Imagem do 3D salva (.png)");
          })
          .catch(() => toast.error("Não foi possível salvar a imagem."));
      },
    };

    return () => {
      apiRef.current = null;
      if (handleRef) handleRef.current = null;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.removeEventListener("start", stopAuto);
      controls.dispose();
      disposeGroup(modelGroup);
      disposeGroup(pedestalGroup);
      grid.geometry.dispose();
      gridMat.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      pGeo.dispose();
      pMat.dispose();
      envTexture.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [container, strokes, aspect, stageHeight, handleRef, showParticles]);

  useEffect(() => {
    apiRef.current?.rebuild(depth, mode, material);
  }, [depth, inflation, material, mode, showWireframe]);

  const updateMode = (nextMode: GeometryMode) => setMode(nextMode);

  const updateMaterial = (nextMaterial: MaterialVariant) =>
    setMaterial(nextMaterial);

  const activeMode = mode;
  const activeMaterial = material;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(890px,96dvh)] w-[min(1240px,96vw)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-border bg-panel p-0 shadow-panel sm:rounded-2xl">
        <DialogHeader className="border-b border-border px-5 py-3 pr-12 text-left">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                  <View className="size-4 text-glow" />
                  Visualização 3D
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs text-muted-foreground">
                Modelagem volumétrica com reflexos de estúdio PBR · Gire com a
                mão aberta ✋ no ar ou arraste com o mouse
              </DialogDescription>
            </div>

            {/* Camera angle presets */}
            <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-panel/80 p-1">
              <span className="px-1 text-[11px] font-medium text-muted-foreground">
                Câmera:
              </span>
              <button
                type="button"
                onClick={() => apiRef.current?.setView("perspective")}
                title="Visão 3D Perspectiva"
                className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-panel hover:text-foreground"
              >
                Perspectiva
              </button>
              <button
                type="button"
                onClick={() => apiRef.current?.setView("front")}
                title="Vista Frontal"
                className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-panel hover:text-foreground"
              >
                Frente
              </button>
              <button
                type="button"
                onClick={() => apiRef.current?.setView("top")}
                title="Vista Superior"
                className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-panel hover:text-foreground"
              >
                Topo
              </button>
              <button
                type="button"
                onClick={() => apiRef.current?.setView("side")}
                title="Vista Lateral"
                className="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-panel hover:text-foreground"
              >
                Lado
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* 3D Mode & Material Selector Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel/50 px-5 py-2.5 text-xs">
          {/* Mode pills */}
          <div className="flex items-center gap-1.5">
            <span className="eyebrow mr-1 text-[11px]">Modo:</span>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => updateMode(m.id)}
                title={m.desc}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors",
                  activeMode === m.id
                    ? "border-glow bg-glow/15 font-medium text-glow"
                    : "border-border/60 bg-panel/60 text-muted-foreground hover:bg-panel hover:text-foreground",
                )}
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          {/* Material pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="eyebrow mr-1 text-[11px]">Material:</span>
            {MATERIALS.map((mat) => (
              <button
                key={mat.id}
                type="button"
                onClick={() => updateMaterial(mat.id)}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors",
                  activeMaterial === mat.id
                    ? "border-glow bg-glow/15 font-medium text-glow"
                    : "border-border/60 bg-panel/60 text-muted-foreground hover:bg-panel hover:text-foreground",
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: mat.dot }}
                />
                <span>{mat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Sliders and Toggles Bar */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-border px-5 py-2 text-xs">
          <label className="flex min-w-36 items-center gap-2">
            <span className="eyebrow">Profundidade</span>
            <Slider
              value={[depth]}
              min={0.5}
              max={3.2}
              step={0.1}
              onValueChange={(v) => setDepth(v[0] ?? 1.4)}
              aria-label="Profundidade"
              className="w-24 sm:w-32"
            />
            <span className="w-6 text-right text-[11px] tabular-nums text-muted-foreground">
              {depth.toFixed(1)}
            </span>
          </label>

          {activeMode === "inflate" && (
            <label className="flex min-w-36 items-center gap-2">
              <span className="eyebrow">Relevo</span>
              <Slider
                value={[inflation]}
                min={0.5}
                max={2.5}
                step={0.1}
                onValueChange={(v) => {
                  const val = v[0] ?? 1.2;
                  setInflation(val);
                }}
                aria-label="Relevo"
                className="w-24 sm:w-32"
              />
              <span className="w-6 text-right text-[11px] tabular-nums text-muted-foreground">
                {inflation.toFixed(1)}
              </span>
            </label>
          )}

          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <Switch
              checked={autoRotate}
              onCheckedChange={(on) => {
                setAutoRotate(on);
                apiRef.current?.setAutoRotate(on);
              }}
              aria-label="Girar sozinho"
            />
            Girar
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <Switch
              checked={showWireframe}
              onCheckedChange={(on) => setShowWireframe(on)}
              aria-label="Malha Wireframe"
            />
            Malha (Wireframe)
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <Switch
              checked={showParticles}
              onCheckedChange={(on) => setShowParticles(on)}
              aria-label="Partículas estelares"
            />
            Partículas
          </label>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="panel"
              size="sm"
              onClick={() => apiRef.current?.reset()}
            >
              <RotateCcw className="size-3.5" /> Recentralizar
            </Button>
            <Button
              variant="panel"
              size="sm"
              onClick={() => apiRef.current?.exportPng()}
            >
              <ImageDown className="size-3.5" /> Imagem (PNG)
            </Button>
            <Button
              variant="glow"
              size="sm"
              onClick={() => apiRef.current?.exportGlb()}
            >
              <Download className="size-3.5" /> Baixar 3D (.glb)
            </Button>
          </div>
        </div>

        {/* 3D WebGL Canvas */}
        <div ref={setContainer} className="relative min-h-0 flex-1 bg-scene" />
      </DialogContent>
    </Dialog>
  );
}
