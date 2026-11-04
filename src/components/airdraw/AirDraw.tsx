import { ClientOnly } from "@tanstack/react-router";
import {
  Box,
  Camera,
  CameraOff,
  Download,
  Eraser,
  Hand,
  Loader2,
  Minus,
  Move,
  Pencil,
  Plus,
  Redo2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import Peer, { type DataConnection } from "peerjs";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  useHandTracking,
  type CameraStatus,
  type HandFrame,
} from "@/hooks/use-hand-tracking";
import { downloadBlob } from "@/lib/airdraw/download";
import { DrawingEngine } from "@/lib/airdraw/engine";
import { clamp, coverMap } from "@/lib/airdraw/geometry";
import { classifyHand, GestureStabilizer } from "@/lib/airdraw/gestures";
import { assignSlots, handProximity } from "@/lib/airdraw/hands";
import { OneEuroFilter } from "@/lib/airdraw/one-euro";
import {
  DEFAULT_SIZE,
  INK_COLORS,
  SIZE_MAX,
  SIZE_MIN,
} from "@/lib/airdraw/palette";
import {
  readCssVar,
  renderHands,
  renderStrokes,
  type RenderTheme,
} from "@/lib/airdraw/render";
import { SHAPE_LABEL, type ShapeKind } from "@/lib/airdraw/shapes";
import {
  loadGallery,
  loadSaved,
  persist,
  persistGallery,
  type GalleryEntry,
} from "@/lib/airdraw/storage";
import type {
  Gesture,
  InputSample,
  Landmark,
  Stroke,
  Tool,
} from "@/lib/airdraw/types";
import { cn } from "@/lib/utils";

import type { Scene3DHandle } from "./Scene3D";

const Scene3D = lazy(() => import("./Scene3D"));

const CAMERA_LABEL: Record<CameraStatus, string> = {
  off: "Câmera desligada",
  loading: "Carregando rastreador…",
  on: "Câmera ativa",
  denied: "Permissão negada",
  unsupported: "Câmera indisponível",
  error: "Erro na câmera",
};

const TOOL_LABEL: Record<Tool, string> = {
  draw: "Desenhar",
  move: "Mover",
  erase: "Apagar",
};

function gestureLabel(g: Gesture, tool: Tool) {
  if (g === "none") return "Sem mão";
  if (g === "idle" || g === "open") return "✋ Pausado";
  if (g === "fist") return "✊ Punho";
  if (g === "pinch") return "🤏 Movendo";
  if (g === "erase") return "✌ Apagando";
  return tool === "draw"
    ? "☝ Desenhando"
    : tool === "erase"
      ? "☝ Apagando"
      : "☝ Apontando";
}

type CursorState = "idle" | "draw" | "pinch" | "erase" | "hover";

type RemoteRole = "host" | "client" | null;
type RemoteState = {
  role: RemoteRole;
  code: string;
  status: string;
};

const BOARD_MODE_PARAM = "board";
const BOARD_SESSION_PREFIX = "airdraw-board:";
const BOARD_SYNC_KEY = "airdraw-board-sync";

function createBoardCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeBoardLink(code: string) {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  url.searchParams.set(BOARD_MODE_PARAM, "phone");
  url.searchParams.set("code", code);
  return url.toString();
}

function readBoardCodeFromUrl() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("code");
}

function parseRemotePayload(
  raw: string,
): { type: "strokes"; strokes: Stroke[] } | null {
  try {
    const data = JSON.parse(raw) as { type?: string; strokes?: Stroke[] };
    if (data.type === "strokes" && Array.isArray(data.strokes)) {
      return { type: "strokes", strokes: data.strokes };
    }
  } catch {
    return null;
  }
  return null;
}

const StatusPill = memo(function StatusPill({
  status,
}: {
  status: CameraStatus;
}) {
  const tone =
    status === "on"
      ? "border-success/40 text-success"
      : status === "loading"
        ? "border-accent/40 text-accent"
        : status === "off"
          ? "border-border text-muted-foreground"
          : "border-destructive/50 text-destructive";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-secondary px-3 py-1.5 font-mono text-[11px]",
        tone,
      )}
      role="status"
    >
      <span
        className={cn(
          "size-1.5 rounded-full bg-current",
          (status === "on" || status === "loading") && "animate-pulse-dot",
        )}
      />
      {CAMERA_LABEL[status]}
    </span>
  );
});

const Card = memo(function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-panel p-4">
      <h2 className="eyebrow mb-3">{title}</h2>
      {children}
    </section>
  );
});

const Row = memo(function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border py-2 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="kbd whitespace-nowrap">{value}</span>
    </div>
  );
});

/** Per-hand tracking state; slot 0 is hand 1, slot 1 is hand 2 (two-hands mode). */
type HandSlot = {
  stabilizer: GestureStabilizer;
  filters: { x: OneEuroFilter; y: OneEuroFilter; z: OneEuroFilter };
  rawPinch: boolean;
  action: Tool | null;
  lastPt: InputSample | null;
  wrist: { x: number; y: number } | null;
  palm: { x: number; y: number } | null;
  gesture: Gesture;
};

function makeSlot(): HandSlot {
  return {
    stabilizer: new GestureStabilizer(),
    filters: {
      x: new OneEuroFilter(),
      y: new OneEuroFilter(),
      z: new OneEuroFilter(0.8, 0.004),
    },
    rawPinch: false,
    action: null,
    lastPt: null,
    wrist: null,
    palm: null,
    gesture: "none",
  };
}

const handKey = (i: number) => `hand${i}`;

/** Hand 2 draws with the palette color after the one chosen for hand 1. */
function secondInk(color: string) {
  const i = INK_COLORS.findIndex((c) => c.value === color);
  return INK_COLORS[(i + 1) % INK_COLORS.length]!.value;
}

export function AirDraw() {
  const [engine] = useState(() => new DrawingEngine());
  const [slots] = useState<HandSlot[]>(() => [makeSlot(), makeSlot()]);

  const [tool, setTool] = useState<Tool>("draw");
  const [color, setColor] = useState<string>(INK_COLORS[0].value);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [neon, setNeon] = useState(true);
  const [multiHand, setMultiHand] = useState(false);
  const [showHands, setShowHands] = useState(true);
  const [snapShapes, setSnapShapes] = useState(false);
  const [pinchSensitivity, setPinchSensitivity] = useState(1);
  const [trackingSmoothness, setTrackingSmoothness] = useState(1);
  const [gallery, setGallery] = useState<GalleryEntry[]>(() => loadGallery());
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [gestures, setGestures] = useState<[Gesture, Gesture]>([
    "none",
    "none",
  ]);
  const gesture = gestures[0];
  const [proximity, setProximity] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState<ShapeKind | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [summary, setSummary] = useState({
    count: 0,
    canUndo: false,
    canRedo: false,
  });
  const [show3D, setShow3D] = useState(false);
  const [scene3DStrokes, setScene3DStrokes] = useState<Stroke[]>([]);
  const [scene3DPreview, setScene3DPreview] = useState<string | null>(null);
  const [a11yHighContrast, setA11yHighContrast] = useState(false);
  const [a11yLargeText, setA11yLargeText] = useState(false);
  const [a11yReducedMotion, setA11yReducedMotion] = useState(false);
  const show3DRef = useRef(false);
  const [stageSize, setStageSize] = useState({ w: 1, h: 1 });
  const [loaded, setLoaded] = useState(false);
  const [introDismissed, setIntroDismissed] = useState(false);
  const [mobileBoardMode, setMobileBoardMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      new URLSearchParams(window.location.search).get(BOARD_MODE_PARAM) ===
      "phone"
    );
  });
  const [remoteState, setRemoteState] = useState<RemoteState>({
    role: null,
    code: "",
    status: "disconnected",
  });
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [mobileBoardCodeInput, setMobileBoardCodeInput] = useState<string>(
    () => readBoardCodeFromUrl() ?? "",
  );

  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const cursor2Ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scene3DRef = useRef<Scene3DHandle | null>(null);
  const proximityRef = useRef<number | null>(null);
  const handsDrawnRef = useRef(false);

  const settingsRef = useRef({
    tool,
    color,
    size,
    neon,
    multiHand,
    showHands,
    snapShapes,
    pinchSensitivity,
    trackingSmoothness,
  });
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });
  const themeRef = useRef<RenderTheme>({
    highlight: "rgba(255,255,255,0.16)",
    core: "#ffffff",
  });
  const highlightRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const pointerActiveRef = useRef(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const remoteConnectionRef = useRef<DataConnection | null>(null);
  const remoteSyncLockRef = useRef(false);

  const requestRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const { w, h, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      renderStrokes(ctx, engine.strokes, w, h, {
        neon: settingsRef.current.neon,
        highlightId: engine.movingId ?? highlightRef.current,
        theme: themeRef.current,
      });
    });
  }, [engine]);

  const closePeerConnection = useCallback(() => {
    remoteConnectionRef.current?.close();
    remoteConnectionRef.current = null;
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
  }, []);

  const shareCanvasState = useCallback(() => {
    const payload = JSON.stringify({
      type: "strokes",
      strokes: engine.strokes,
    });
    if (typeof window === "undefined" || remoteSyncLockRef.current) return;

    const connection = remoteConnectionRef.current;
    if (connection && connection.open) {
      connection.send(payload);
      return;
    }

    if (remoteState.role === "host" || remoteState.role === "client") {
      localStorage.setItem(BOARD_SESSION_PREFIX + remoteState.code, payload);
    }
  }, [engine, remoteState.code, remoteState.role]);

  const connectRemote = useCallback(
    (mode: "host" | "client", code?: string) => {
      if (typeof window === "undefined") return;

      closePeerConnection();

      if (mode === "host") {
        const nextCode = createBoardCode();
        const peer = new Peer(nextCode, {
          host: "0.peerjs.com",
          port: 443,
          secure: true,
        });
        peerRef.current = peer;

        peer.on("open", () => {
          setRemoteState({ role: "host", code: nextCode, status: "connected" });
          setRemoteError(null);
          const link = makeBoardLink(nextCode);
          navigator.clipboard?.writeText(link).catch(() => {});
          const payload = JSON.stringify({
            type: "strokes",
            strokes: engine.strokes,
          });
          localStorage.setItem(BOARD_SESSION_PREFIX + nextCode, payload);
        });

        peer.on("connection", (connection) => {
          remoteConnectionRef.current = connection;
          connection.on("open", () => {
            setRemoteState((prev) =>
              prev.role === "host"
                ? { ...prev, status: "connected" }
                : { role: "host", code: nextCode, status: "connected" },
            );
            connection.send(
              JSON.stringify({ type: "strokes", strokes: engine.strokes }),
            );
          });

          connection.on("data", (value) => {
            const parsed = parseRemotePayload(
              typeof value === "string" ? value : JSON.stringify(value),
            );
            if (!parsed) return;
            remoteSyncLockRef.current = true;
            engine.load(parsed.strokes);
            requestRender();
            window.setTimeout(() => {
              remoteSyncLockRef.current = false;
            }, 0);
          });

          connection.on("close", () => {
            remoteConnectionRef.current = null;
          });
        });

        peer.on("error", (error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          setRemoteError(`Erro na lousa: ${message}`);
          setRemoteState({ role: null, code: "", status: "disconnected" });
        });

        return;
      }

      const boardCode = code ?? readBoardCodeFromUrl() ?? "";
      if (!boardCode) {
        setRemoteError("Use o link gerado pela lousa principal.");
        return;
      }

      const existingPayload = localStorage.getItem(
        BOARD_SESSION_PREFIX + boardCode,
      );
      if (existingPayload) {
        const parsed = parseRemotePayload(existingPayload);
        if (parsed) {
          remoteSyncLockRef.current = true;
          engine.load(parsed.strokes);
          requestRender();
          window.setTimeout(() => {
            remoteSyncLockRef.current = false;
          }, 0);
        }
      }

      const peer = new Peer(undefined, {
        host: "0.peerjs.com",
        port: 443,
        secure: true,
      });
      peerRef.current = peer;

      peer.on("open", () => {
        setRemoteState({
          role: "client",
          code: boardCode,
          status: "connecting",
        });
        const connection = peer.connect(boardCode, { reliable: true });
        remoteConnectionRef.current = connection;

        connection.on("open", () => {
          setRemoteState({
            role: "client",
            code: boardCode,
            status: "connected",
          });
          setRemoteError(null);
          connection.send(
            JSON.stringify({ type: "strokes", strokes: engine.strokes }),
          );
        });

        connection.on("data", (value) => {
          const parsed = parseRemotePayload(
            typeof value === "string" ? value : JSON.stringify(value),
          );
          if (!parsed) return;
          remoteSyncLockRef.current = true;
          engine.load(parsed.strokes);
          requestRender();
          window.setTimeout(() => {
            remoteSyncLockRef.current = false;
          }, 0);
        });

        connection.on("close", () => {
          remoteConnectionRef.current = null;
          setRemoteState({ role: null, code: "", status: "disconnected" });
        });
      });

      peer.on("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        setRemoteError(
          `Não foi possível conectar ao código ${boardCode}: ${message}`,
        );
        setRemoteState({ role: null, code: "", status: "disconnected" });
      });

      setRemoteError(null);
    },
    [closePeerConnection, engine, requestRender],
  );

  const disconnectRemote = useCallback(() => {
    closePeerConnection();
    setRemoteState({ role: null, code: "", status: "disconnected" });
    setRemoteError(null);
    setMobileBoardCodeInput(readBoardCodeFromUrl() ?? "");
  }, [closePeerConnection]);

  const syncBoardCodeFromUrl = useCallback(() => {
    const codeFromUrl = readBoardCodeFromUrl() ?? "";
    if (codeFromUrl && !remoteState.role) {
      setMobileBoardCodeInput(codeFromUrl);
    }
  }, [remoteState.role]);

  useEffect(() => {
    syncBoardCodeFromUrl();
  }, [syncBoardCodeFromUrl]);

  useEffect(() => {
    return () => {
      closePeerConnection();
    };
  }, [closePeerConnection]);

  useEffect(() => {
    const sync = () => {
      if (remoteState.role && !remoteSyncLockRef.current) shareCanvasState();
    };
    sync();
    return engine.subscribe(sync);
  }, [engine, remoteState.role, shareCanvasState]);

  useEffect(() => {
    settingsRef.current = {
      tool,
      color,
      size,
      neon,
      multiHand,
      showHands,
      snapShapes,
      pinchSensitivity,
      trackingSmoothness,
    };
    engine.snapShapes = snapShapes;
  }, [
    engine,
    tool,
    color,
    size,
    neon,
    multiHand,
    showHands,
    snapShapes,
    pinchSensitivity,
    trackingSmoothness,
  ]);

  useEffect(() => {
    themeRef.current = {
      highlight: readCssVar("--canvas-highlight") || themeRef.current.highlight,
      core: readCssVar("--canvas-core") || themeRef.current.core,
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: r.width, h: r.height, dpr };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      const hc = handCanvasRef.current;
      if (hc) {
        hc.width = canvas.width;
        hc.height = canvas.height;
      }
      engine.setViewport(r.width, r.height);
      setStageSize({ w: r.width, h: r.height });
      requestRender();
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [engine, requestRender]);

  // ---------- persistence ----------
  const schedulePersist = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persist({ strokes: engine.strokes, settings: settingsRef.current });
    }, 400);
  }, [engine]);

  const applyTrackingProfile = useCallback(
    (smoothness: number) => {
      const profile = {
        minCutoff: 0.8 + (2.2 - smoothness) * 0.7,
        beta: 0.012 * smoothness,
      };
      slots.forEach((slot) => {
        slot.filters.x = new OneEuroFilter(
          profile.minCutoff,
          profile.beta,
          1.2,
        );
        slot.filters.y = new OneEuroFilter(
          profile.minCutoff,
          profile.beta,
          1.2,
        );
        slot.filters.z = new OneEuroFilter(
          Math.max(0.7, profile.minCutoff * 0.8),
          profile.beta,
          1.0,
        );
      });
    },
    [slots],
  );

  useEffect(() => {
    applyTrackingProfile(trackingSmoothness);
  }, [applyTrackingProfile, trackingSmoothness]);

  useEffect(() => {
    const saved = loadSaved();
    if (saved) {
      engine.load(saved.strokes);
      const s = saved.settings;
      if (s?.color) setColor(s.color);
      if (s?.size) setSize(clamp(s.size, SIZE_MIN, SIZE_MAX));
      if (typeof s?.neon === "boolean") setNeon(s.neon);
      if (s?.tool) setTool(s.tool);
      if (typeof s?.multiHand === "boolean") setMultiHand(s.multiHand);
      if (typeof s?.showHands === "boolean") setShowHands(s.showHands);
      if (typeof s?.snapShapes === "boolean") setSnapShapes(s.snapShapes);
      if (typeof s?.pinchSensitivity === "number")
        setPinchSensitivity(clamp(s.pinchSensitivity, 0.6, 1.8));
      if (typeof s?.trackingSmoothness === "number")
        setTrackingSmoothness(clamp(s.trackingSmoothness, 0.6, 2));
    }
    setLoaded(true);
  }, [engine]);

  useEffect(() => {
    if (loaded) schedulePersist();
    requestRender();
  }, [
    tool,
    color,
    size,
    neon,
    multiHand,
    showHands,
    snapShapes,
    pinchSensitivity,
    trackingSmoothness,
    loaded,
    schedulePersist,
    requestRender,
  ]);

  useEffect(() => {
    const sync = () => {
      requestRender();
      setSummary((prev) => {
        const next = {
          count: engine.strokes.length,
          canUndo: engine.canUndo,
          canRedo: engine.canRedo,
        };
        return prev.count === next.count &&
          prev.canUndo === next.canUndo &&
          prev.canRedo === next.canRedo
          ? prev
          : next;
      });
      setSuggestion(engine.shapeSuggestion);
      schedulePersist();
    };
    sync();
    return engine.subscribe(sync);
  }, [engine, requestRender, schedulePersist]);

  // ---------- cursor ----------
  const updateCursor = useCallback(
    (
      slot: number,
      pt: { x: number; y: number } | null,
      visible: boolean,
      state: CursorState,
    ) => {
      const el = slot === 0 ? cursorRef.current : cursor2Ref.current;
      if (!el) return;
      if (pt) el.style.transform = `translate3d(${pt.x}px, ${pt.y}px, 0)`;
      el.dataset["visible"] = String(visible && !!pt);
      el.dataset["state"] = state;
    },
    [],
  );

  const setHover = useCallback(
    (id: string | null) => {
      if (id !== highlightRef.current) {
        highlightRef.current = id;
        requestRender();
      }
    },
    [requestRender],
  );

  // ---------- hand input ----------
  const drawHandOverlay = useCallback(
    (hands: { points: { x: number; y: number }[]; color: string }[]) => {
      const ctx = handCanvasRef.current?.getContext("2d");
      if (!ctx) return;
      if (!hands.length && !handsDrawnRef.current) return;
      const { w, h, dpr } = sizeRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      renderHands(ctx, hands);
      handsDrawnRef.current = hands.length > 0;
    },
    [],
  );

  const endHandActions = useCallback(() => {
    slots.forEach((slot, i) => {
      if (slot.action) engine.end(handKey(i));
      slot.action = null;
    });
  }, [engine, slots]);

  const resetHand = useCallback(() => {
    endHandActions();
    slots.forEach((slot, i) => {
      slot.stabilizer.reset();
      slot.filters.x.reset();
      slot.filters.y.reset();
      slot.filters.z.reset();
      slot.rawPinch = false;
      slot.lastPt = null;
      slot.wrist = null;
      slot.palm = null;
      slot.gesture = "none";
      updateCursor(i, null, false, "idle");
    });
    setGestures(["none", "none"]);
    proximityRef.current = null;
    setProximity(null);
    setHover(null);
    drawHandOverlay([]);
  }, [slots, endHandActions, setHover, updateCursor, drawHandOverlay]);

  const onHandFrame = useCallback(
    (f: HandFrame) => {
      const stage = sizeRef.current;
      const {
        tool: t,
        color: c,
        size: s,
        multiHand: multi,
        showHands: show,
      } = settingsRef.current;
      const aspect =
        f.videoWidth && f.videoHeight ? f.videoWidth / f.videoHeight : 16 / 9;
      const video = { w: f.videoWidth, h: f.videoHeight };
      const nSlots = multi ? 2 : 1;
      const detected = f.hands.slice(0, nSlots);
      const assigned =
        nSlots === 1
          ? detected.map((_, i) => i)
          : assignSlots(
              slots.slice(0, nSlots).map((sl) => sl.wrist),
              detected.map((h) => h.landmarks[0] ?? { x: 0.5, y: 0.5 }),
            );
      const bySlot: (Landmark[] | null)[] = slots.map(() => null);
      detected.forEach((h, i) => {
        const k = assigned[i];
        if (k !== undefined && k >= 0) bySlot[k] = h.landmarks;
      });
      const in3D = show3DRef.current;
      const overlay: { points: { x: number; y: number }[]; color: string }[] =
        [];
      let gesturesChanged = false;

      slots.forEach((slot, i) => {
        const key = handKey(i);
        const lm = bySlot[i];
        const inkColor = i === 0 ? c : secondInk(c);
        let g: Gesture;
        let sample: InputSample | null = null;

        if (lm) {
          const tip = lm[8] ?? { x: 0.5, y: 0.5, z: 0 };
          const thumb = lm[4] ?? tip;
          const middleTip = lm[12] ?? tip;
          const raw = classifyHand(
            lm,
            aspect,
            slot.rawPinch,
            settingsRef.current.pinchSensitivity,
          );
          slot.rawPinch = raw === "pinch";
          g = slot.stabilizer.update(raw);
          slot.wrist = { x: lm[0]?.x ?? tip.x, y: lm[0]?.y ?? tip.y };
          const anchor =
            g === "pinch"
              ? { x: (thumb.x + tip.x) / 2, y: (thumb.y + tip.y) / 2 }
              : g === "erase"
                ? { x: (middleTip.x + tip.x) / 2, y: (middleTip.y + tip.y) / 2 }
                : tip;
          const m = coverMap(anchor, video, stage);
          sample = {
            x: slot.filters.x.filter(m.x, f.t),
            y: slot.filters.y.filter(m.y, f.t),
            z: slot.filters.z.filter(tip.z, f.t),
            t: f.t,
          };
          slot.lastPt = sample;
          if (show && !in3D) {
            overlay.push({
              points: lm.map((p) => coverMap(p, video, stage)),
              color: inkColor,
            });
          }
          if (i === 0) {
            const prox = handProximity(lm, aspect);
            const rounded = prox === null ? null : Math.round(prox / 5) * 5;
            if (rounded !== proximityRef.current) {
              proximityRef.current = rounded;
              setProximity(rounded);
            }
          }
        } else {
          slot.rawPinch = false;
          g = slot.stabilizer.update("none");
          if (g === "none") {
            slot.filters.x.reset();
            slot.filters.y.reset();
            slot.filters.z.reset();
            slot.wrist = null;
          }
          if (i === 0 && g === "none" && proximityRef.current !== null) {
            proximityRef.current = null;
            setProximity(null);
          }
        }

        if (in3D) {
          const knuckle = lm?.[9];
          if (knuckle && g === "open") {
            const p = coverMap(knuckle, video, stage);
            const palm = {
              x: p.x / Math.max(stage.w, 1),
              y: p.y / Math.max(stage.h, 1),
            };
            if (slot.palm) {
              scene3DRef.current?.rotateBy(
                (palm.x - slot.palm.x) * 6,
                (palm.y - slot.palm.y) * 4,
              );
            }
            slot.palm = palm;
          } else {
            slot.palm = null;
          }
          updateCursor(i, null, false, "idle");
        } else {
          slot.palm = null;
          const desired: Tool | null =
            g === "pinch"
              ? "move"
              : g === "erase"
                ? "erase"
                : g === "point" && t !== "move"
                  ? t
                  : null;

          if (!pointerActiveRef.current) {
            if (desired !== slot.action) {
              if (slot.action) engine.end(key);
              slot.action = null;
              if (desired && sample) {
                engine.begin(
                  desired,
                  sample,
                  { color: inkColor, size: s },
                  key,
                );
                slot.action = desired;
              }
            } else if (desired && sample) {
              engine.update(sample, key);
            }
          }

          const hover =
            sample && g === "point" && t === "move"
              ? engine.hitTest(sample)
              : null;
          if (i === 0) setHover(hover);

          const cursorState: CursorState =
            g === "pinch"
              ? "pinch"
              : g === "erase"
                ? "erase"
                : g === "point"
                  ? t === "draw"
                    ? "draw"
                    : t === "erase"
                      ? "erase"
                      : hover
                        ? "hover"
                        : "idle"
                  : "idle";
          updateCursor(i, sample ?? slot.lastPt, g !== "none", cursorState);
        }

        if (g !== slot.gesture) {
          slot.gesture = g;
          gesturesChanged = true;
        }
      });

      if (gesturesChanged) setGestures([slots[0]!.gesture, slots[1]!.gesture]);
      drawHandOverlay(overlay);
    },
    [engine, slots, setHover, updateCursor, drawHandOverlay],
  );

  const camera = useHandTracking(videoRef, onHandFrame, multiHand ? 2 : 1);

  // Turning two-hands mode off ends whatever hand 2 was doing.
  useEffect(() => {
    if (multiHand) return;
    const slot = slots[1]!;
    if (slot.action) engine.end(handKey(1));
    slot.action = null;
    slot.stabilizer.reset();
    slot.wrist = null;
    slot.gesture = "none";
    updateCursor(1, null, false, "idle");
    setGestures((g) => (g[1] === "none" ? g : [g[0], "none"]));
  }, [multiHand, engine, slots, updateCursor]);

  const toggleCamera = useCallback(() => {
    if (camera.status === "on" || camera.status === "loading") {
      camera.stop();
      resetHand();
    } else {
      void camera.start();
    }
  }, [camera, resetHand]);

  useEffect(() => {
    if (camera.status === "denied")
      toast.error("Permissão da câmera negada", {
        description:
          "Libere a câmera no ícone de cadeado da barra de endereço e tente de novo. Você ainda pode desenhar com o mouse ou o dedo.",
      });
    else if (camera.status === "unsupported")
      toast.error("Este navegador não oferece acesso à câmera.", {
        description: "Desenhe com o mouse ou o dedo na tela.",
      });
    else if (camera.status === "error")
      toast.error("Não foi possível iniciar a câmera ou o rastreador de mãos.");
    else if (camera.status === "on")
      toast.success("Câmera ativa — mostre sua mão ✋");
  }, [camera.status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setA11yReducedMotion(media.matches);
    syncMotion();
    media.addEventListener?.("change", syncMotion);
    return () => media.removeEventListener?.("change", syncMotion);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("a11y-high-contrast", a11yHighContrast);
    root.classList.toggle("a11y-large-text", a11yLargeText);
    root.classList.toggle("a11y-reduced-motion", a11yReducedMotion);
  }, [a11yHighContrast, a11yLargeText, a11yReducedMotion]);

  // ---------- mouse / touch input ----------
  const localSample = (e: ReactPointerEvent | PointerEvent): InputSample => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    endHandActions();
    pointerActiveRef.current = true;
    const { tool: t, color: c, size: s } = settingsRef.current;
    engine.begin(t, localSample(e), { color: c, size: s });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerActiveRef.current) {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events.length ? events : [e.nativeEvent])
        engine.update(localSample(ev));
    } else if (
      settingsRef.current.tool === "move" &&
      e.pointerType === "mouse"
    ) {
      setHover(engine.hitTest(localSample(e)));
    }
  };

  const onPointerUp = () => {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    engine.end();
  };

  // ---------- actions ----------
  const undo = useCallback(() => engine.undo(), [engine]);
  const applyShape = useCallback(() => {
    const kind = engine.applySuggestion();
    if (kind)
      toast(`Ajustado para ${SHAPE_LABEL[kind]}`, {
        action: { label: "Desfazer", onClick: () => engine.undo() },
      });
  }, [engine]);

  const redo = useCallback(() => engine.redo(), [engine]);
  const clearAll = useCallback(() => {
    if (!engine.strokes.length) return;
    engine.clear();
    toast("Tela limpa", {
      action: { label: "Desfazer", onClick: () => engine.undo() },
    });
  }, [engine]);

  const renderCurrentToDataUrl = useCallback(() => {
    const { w, h } = sizeRef.current;
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    ctx.fillStyle = readCssVar("--canvas-bg") || "#0b0f17";
    ctx.fillRect(0, 0, w, h);
    renderStrokes(ctx, engine.strokes, w, h, {
      neon: settingsRef.current.neon,
      highlightId: null,
      theme: themeRef.current,
    });
    return c.toDataURL("image/png");
  }, [engine]);

  const open3D = useCallback(() => {
    if (!engine.strokes.length) {
      toast("Desenhe algo primeiro para ver em 3D ✦");
      return;
    }
    const preview = renderCurrentToDataUrl();
    setScene3DStrokes(engine.strokes);
    setScene3DPreview(preview);
    show3DRef.current = true;
    resetHand();
    setShow3D(true);
  }, [engine, renderCurrentToDataUrl, resetHand]);

  const onScene3DOpenChange = useCallback((open: boolean) => {
    show3DRef.current = open;
    setShow3D(open);
  }, []);

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, [contenteditable='true'], [role='dialog']",
        )
      )
        return;
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) engine.redo();
        else engine.undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        engine.redo();
        return;
      }
      if (mod || e.altKey) return;
      if (key === "d") setTool("draw");
      else if (key === "m") setTool("move");
      else if (key === "e") setTool("erase");
      else if (key === "[") setSize((v) => clamp(v - 2, SIZE_MIN, SIZE_MAX));
      else if (key === "]") setSize((v) => clamp(v + 2, SIZE_MIN, SIZE_MAX));
      else if (key === "n") setNeon((v) => !v);
      else if (/^[1-9]$/.test(key)) {
        const ink = INK_COLORS[Number(key) - 1];
        if (ink) setColor(ink.value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  // Hover highlight only makes sense in move mode.
  useEffect(() => {
    if (tool !== "move") setHover(null);
  }, [tool, setHover]);

  const camOn = camera.status === "on";
  const camBusy = camera.status === "loading";
  const showOnboarding = !camOn && summary.count === 0 && !introDismissed;

  const panel = (
    <>
      <Card title="Câmera">
        <p className="mb-3 text-sm text-muted-foreground">
          {CAMERA_LABEL[camera.status]}
        </p>
        <Button
          variant={camOn ? "panel" : "glow"}
          className="w-full"
          onClick={toggleCamera}
          disabled={camBusy}
        >
          {camBusy ? (
            <Loader2 className="animate-spin" />
          ) : camOn ? (
            <CameraOff />
          ) : (
            <Camera />
          )}
          {camBusy
            ? "Carregando…"
            : camOn
              ? "Desligar câmera"
              : "Ativar câmera"}
        </Button>
      </Card>

      <Card title="Acessibilidade">
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>Alto contraste</span>
          <Switch
            checked={a11yHighContrast}
            onCheckedChange={setA11yHighContrast}
            aria-label="Ativar alto contraste"
          />
        </label>
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>Texto maior</span>
          <Switch
            checked={a11yLargeText}
            onCheckedChange={setA11yLargeText}
            aria-label="Aumentar o tamanho do texto"
          />
        </label>
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>Reduzir movimento</span>
          <Switch
            checked={a11yReducedMotion}
            onCheckedChange={setA11yReducedMotion}
            aria-label="Reduzir movimento e animações"
          />
        </label>
      </Card>

      <Card title="Pincel">
        <div className="mb-3 flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-xl border border-border bg-background">
            <span
              className="block rounded-full"
              style={{
                width: Math.min(size, 40),
                height: Math.min(size, 40),
                backgroundColor: color,
                boxShadow: neon ? `0 0 ${size}px ${color}` : undefined,
              }}
            />
          </div>
          <div>
            <div className="text-2xl font-bold">
              {size}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                px
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              <span className="kbd">[</span> <span className="kbd">]</span> para
              ajustar
            </div>
          </div>
        </div>
        <Slider
          value={[size]}
          min={SIZE_MIN}
          max={SIZE_MAX}
          step={1}
          onValueChange={(v) => setSize(v[0] ?? DEFAULT_SIZE)}
          aria-label="Tamanho do pincel"
        />
        <label className="mt-4 flex cursor-pointer items-center justify-between text-sm">
          <span>
            Efeito neon <span className="kbd ml-1">N</span>
          </span>
          <Switch
            checked={neon}
            onCheckedChange={setNeon}
            aria-label="Efeito neon"
          />
        </label>
        <p className="mt-2 text-[11px] text-muted-foreground">
          O traço engrossa quando você desenha devagar.
        </p>
      </Card>

      <Card title="Mãos">
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>👐 Duas mãos</span>
          <Switch
            checked={multiHand}
            onCheckedChange={setMultiHand}
            aria-label="Duas mãos"
          />
        </label>
        <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          Cada mão desenha com uma cor:
          <span className="inline-flex items-center gap-1">
            1{" "}
            <span
              className="size-3 rounded-full"
              style={{ backgroundColor: color }}
            />
          </span>
          {multiHand && (
            <span className="inline-flex items-center gap-1">
              2{" "}
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: secondInk(color) }}
              />
            </span>
          )}
        </p>
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>Mostrar mão na tela</span>
          <Switch
            checked={showHands}
            onCheckedChange={setShowHands}
            aria-label="Mostrar mão na tela"
          />
        </label>
        <div className="mt-3">
          <Row
            label="Gesto"
            value={camOn ? gestureLabel(gesture, tool) : "—"}
          />
          <Row
            label="Proximidade"
            value={camOn && proximity !== null ? `${proximity}% perto` : "—"}
          />
        </div>
      </Card>

      <Card title="Formas">
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2">
            <Wand2 className="size-4 text-accent" aria-hidden /> Ajustar sozinho
          </span>
          <Switch
            checked={snapShapes}
            onCheckedChange={setSnapShapes}
            aria-label="Ajustar formas sozinho"
          />
        </label>
        <Button
          variant="panel"
          className="mt-3 w-full"
          disabled={!suggestion}
          onClick={applyShape}
        >
          <Wand2 />
          {suggestion
            ? `Ajustar para ${SHAPE_LABEL[suggestion]}`
            : "Nenhuma forma reconhecida"}
        </Button>
      </Card>

      <Card title="Ajustes">
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>Pinça</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {pinchSensitivity.toFixed(2)}x
              </span>
            </div>
            <Slider
              value={[pinchSensitivity]}
              min={0.6}
              max={1.8}
              step={0.05}
              onValueChange={(v) => setPinchSensitivity(v[0] ?? 1)}
              aria-label="Sensibilidade do gesto de pinça"
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>Suavização</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {trackingSmoothness.toFixed(2)}x
              </span>
            </div>
            <Slider
              value={[trackingSmoothness]}
              min={0.6}
              max={2}
              step={0.05}
              onValueChange={(v) => setTrackingSmoothness(v[0] ?? 1)}
              aria-label="Suavização do rastreamento"
            />
          </div>
          <Button
            variant="panel"
            className="w-full"
            onClick={() => setTutorialOpen(true)}
          >
            <Sparkles /> Ver tutorial rápido
          </Button>
        </div>
      </Card>

      <Card title="3D">
        <Button
          variant="panel"
          className="w-full"
          disabled={summary.count === 0}
          onClick={open3D}
        >
          <Box className="size-4" />
          Ver em 3D
        </Button>
      </Card>

      <Card title="Gestos">
        <Row
          label="☝ Indicador esticado"
          value={tool === "erase" ? "APAGAR" : "DESENHAR"}
        />
        <Row label="🤏 Polegar + indicador" value="MOVER" />
        <Row label="✌ Indicador + médio" value="APAGAR" />
        <Row label="✋ Mão aberta" value="PAUSAR" />
        <Row label="✋ Mão aberta (no 3D)" value="GIRAR" />
      </Card>

      <Card title="Atalhos">
        <Row label="Desenhar / Mover / Apagar" value="D · M · E" />
        <Row label="Desfazer / Refazer" value="Ctrl Z · Ctrl Y" />
        <Row label="Cores" value="1 – 6" />
      </Card>

      <Card title="Lousa do celular">
        <div className="space-y-4">
          <div className="rounded-2xl border border-dashed border-border bg-background/80 p-3">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Código da lousa
            </p>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 rounded-xl border border-border bg-panel px-3 py-2 text-center font-mono text-xl tracking-[0.35em] text-foreground">
                {remoteState.code || "— — — —"}
              </div>
              {remoteState.role === "host" && remoteState.code && (
                <Button
                  variant="panel"
                  size="sm"
                  onClick={() =>
                    navigator.clipboard
                      ?.writeText(makeBoardLink(remoteState.code))
                      .catch(() => {})
                  }
                >
                  Copiar
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Digite o código do celular
            </label>
            <div className="flex gap-2">
              <Input
                value={mobileBoardCodeInput}
                onChange={(e) =>
                  setMobileBoardCodeInput(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 6),
                  )
                }
                placeholder="EX: AB12CD"
                maxLength={6}
                className="font-mono uppercase"
                aria-label="Código da lousa do celular"
              />
              <Button
                variant="panel"
                onClick={() =>
                  void connectRemote(
                    "client",
                    mobileBoardCodeInput || undefined,
                  )
                }
              >
                Entrar
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="panel"
              className="flex-1"
              onClick={() => void connectRemote("host")}
            >
              Criar código
            </Button>
            {remoteState.role && (
              <Button
                variant="ghost"
                className="flex-1"
                onClick={disconnectRemote}
              >
                Encerrar
              </Button>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Abra o link gerado no celular ou use o código acima para conectar a
            lousa.
          </p>
          {remoteError && (
            <p className="text-xs text-destructive">{remoteError}</p>
          )}
        </div>
      </Card>

      <p className="px-1 text-[11px] text-muted-foreground">
        {summary.count} {summary.count === 1 ? "traço" : "traços"} · salvo
        automaticamente neste navegador
      </p>
    </>
  );

  const canvasCursor =
    tool === "draw"
      ? "cursor-crosshair"
      : tool === "move"
        ? "cursor-grab"
        : "cursor-cell";

  return (
    <div className="grid h-dvh grid-cols-[64px_1fr] grid-rows-[60px_1fr] overflow-hidden bg-background text-foreground sm:grid-cols-[80px_1fr] lg:grid-cols-[80px_1fr_300px]">
      {/* Top bar */}
      <header className="col-span-2 flex items-center justify-between gap-3 border-b border-border bg-rail px-3 sm:px-5 lg:col-span-3">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-brand text-primary-foreground shadow-glow">
            <Sparkles className="size-4" aria-hidden />
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-bold tracking-tight">AirDraw</h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              desenhe no ar com suas mãos
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs" aria-live="polite">
          <StatusPill status={camera.status} />
          <Button
            variant="panel"
            size="sm"
            className="hidden md:inline-flex"
            disabled={summary.count === 0}
            onClick={open3D}
          >
            <Box className="size-3.5" />
            Ver em 3D
          </Button>
          <Button
            variant="panel"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => setMobileBoardMode((v) => !v)}
          >
            {mobileBoardMode ? "Modo lousa" : "Lousa celular"}
          </Button>
          {camOn && (
            <span className="hidden rounded-full border border-border bg-secondary px-3 py-1.5 font-mono text-[11px] text-secondary-foreground sm:inline-block">
              {multiHand && "1: "}
              {gestureLabel(gestures[0], tool)}
            </span>
          )}
          {camOn && multiHand && (
            <span className="hidden rounded-full border border-border bg-secondary px-3 py-1.5 font-mono text-[11px] text-secondary-foreground md:inline-block">
              2: {gestureLabel(gestures[1], tool)}
            </span>
          )}
        </div>
      </header>

      {/* Tool rail */}
      <aside
        className="flex flex-col items-center gap-2 overflow-y-auto border-r border-border bg-rail px-2 py-3"
        aria-label="Ferramentas"
      >
        {(
          [
            { id: "draw", icon: Pencil, key: "D" },
            { id: "move", icon: Move, key: "M" },
            { id: "erase", icon: Eraser, key: "E" },
          ] as const
        ).map(({ id, icon: Icon, key }) => (
          <Button
            key={id}
            variant="tool"
            size="tool"
            data-active={tool === id}
            aria-pressed={tool === id}
            aria-label={`${TOOL_LABEL[id]} (${key})`}
            title={`${TOOL_LABEL[id]} (${key})`}
            onClick={() => setTool(id)}
          >
            <Icon />
          </Button>
        ))}
        <div className="my-1 h-px w-10 bg-border" />
        <Button
          variant="tool"
          size="tool"
          aria-label="Desfazer (Ctrl+Z)"
          title="Desfazer (Ctrl+Z)"
          disabled={!summary.canUndo}
          onClick={undo}
        >
          <Undo2 />
        </Button>
        <Button
          variant="tool"
          size="tool"
          aria-label="Refazer (Ctrl+Shift+Z)"
          title="Refazer (Ctrl+Shift+Z)"
          disabled={!summary.canRedo}
          onClick={redo}
        >
          <Redo2 />
        </Button>
        <Button
          variant="tool"
          size="tool"
          aria-label="Limpar tela"
          title="Limpar tela"
          disabled={summary.count === 0}
          onClick={clearAll}
        >
          <Trash2 />
        </Button>
        <div className="my-1 h-px w-10 bg-border" />
        <div
          className="flex flex-col items-center gap-2"
          role="radiogroup"
          aria-label="Cor do pincel"
        >
          {INK_COLORS.map((ink, i) => (
            <button
              key={ink.value}
              type="button"
              role="radio"
              aria-checked={color === ink.value}
              aria-label={`${ink.name} (${i + 1})`}
              title={`${ink.name} (${i + 1})`}
              onClick={() => setColor(ink.value)}
              className={cn(
                "size-7 shrink-0 cursor-pointer rounded-full border-2 border-border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                color === ink.value &&
                  "scale-110 outline-2 outline-offset-2 outline-foreground outline-solid",
              )}
              style={{ backgroundColor: ink.value }}
            />
          ))}
        </div>
      </aside>

      {/* Stage */}
      <main
        ref={stageRef}
        className="relative overflow-hidden bg-stage"
        aria-label="Área de desenho"
        role="application"
      >
        <div className="sr-only" aria-live="polite">
          {camera.status === "on"
            ? `Câmera ativa. ${gestureLabel(gestures[0], tool)}`
            : `Câmera ${CAMERA_LABEL[camera.status]}`}
        </div>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          aria-hidden
          className={cn(
            "camera-feed absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
            camOn ? "opacity-80" : "opacity-0",
          )}
        />
        <div className="stage-vignette pointer-events-none absolute inset-0" />
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label="Área de desenho com mouse, toque ou gestos de mão"
          className={cn(
            "absolute inset-0 h-full w-full touch-none focus-visible:outline-none",
            canvasCursor,
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)}
        />
        <canvas
          ref={handCanvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        />
        <div
          ref={cursorRef}
          className="air-cursor"
          data-visible="false"
          aria-hidden
        />
        <div
          ref={cursor2Ref}
          className="air-cursor"
          data-visible="false"
          aria-hidden
        />

        {suggestion && !snapShapes && (
          <div
            className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-overlay py-1 pl-3 pr-1 text-xs shadow-panel backdrop-blur-md"
            role="status"
          >
            <Wand2 className="size-3.5 text-accent" aria-hidden />
            <span>
              Parece um{" "}
              <b className="text-foreground">{SHAPE_LABEL[suggestion]}</b>
            </span>
            <Button
              variant="glow"
              size="sm"
              className="h-7 rounded-full px-3"
              onClick={applyShape}
            >
              Ajustar
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full"
              aria-label="Dispensar sugestão"
              onClick={() => engine.dismissSuggestion()}
            >
              <X />
            </Button>
          </div>
        )}

        {showOnboarding && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
            <div className="pointer-events-auto max-w-sm rounded-2xl border border-border bg-overlay p-6 text-center shadow-panel backdrop-blur-md">
              <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-brand text-primary-foreground shadow-glow">
                <Sparkles className="size-5" aria-hidden />
              </div>
              <h2 className="text-xl font-bold tracking-tight">
                Desenhe no ar
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Ative a câmera e use o dedo indicador como pincel. Sem câmera?
                Desenhe com o mouse ou com o dedo na tela.
              </p>
              <Button
                variant="glow"
                size="lg"
                className="mt-5 w-full"
                onClick={toggleCamera}
                disabled={camBusy}
              >
                {camBusy ? <Loader2 className="animate-spin" /> : <Camera />}
                {camBusy ? "Carregando rastreador…" : "Ativar câmera"}
              </Button>
              {camera.status === "denied" && (
                <p className="mt-3 text-xs text-warning">
                  O navegador bloqueou a câmera. Libere no ícone de cadeado ao
                  lado do endereço.
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full text-muted-foreground"
                onClick={() => setIntroDismissed(true)}
              >
                Desenhar sem câmera
              </Button>
              <p className="mt-2 text-[11px] text-muted-foreground">
                O vídeo é processado no seu aparelho e não é enviado para lugar
                nenhum.
              </p>
            </div>
          </div>
        )}

        {camOn && (
          <div className="pointer-events-none absolute bottom-5 left-5 hidden max-w-xs rounded-xl border border-border bg-overlay px-4 py-3 text-xs leading-relaxed text-muted-foreground backdrop-blur-md lg:block">
            <p className="mb-1 font-semibold text-foreground">
              {gesture === "none"
                ? "Mostre sua mão para a câmera"
                : "Como usar"}
            </p>
            <p>
              <span className="text-primary">☝ Indicador esticado</span> →{" "}
              {tool === "erase"
                ? "apaga"
                : tool === "move"
                  ? "aponta"
                  : "desenha"}
            </p>
            <p>
              <span className="text-success">🤏 Pinça</span> → pega e move um
              traço
            </p>
            <p>
              <span className="text-accent">✌ Dois dedos</span> → borracha
            </p>
            <p>✋ Mão aberta → pausa (no 3D, gira o modelo)</p>
            {multiHand && <p>👐 Duas mãos → cada uma desenha com sua cor</p>}
          </div>
        )}

        {/* Mobile action bar */}
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-1 rounded-2xl border border-border bg-overlay p-1.5 backdrop-blur-md lg:hidden">
          <Button
            variant={camOn ? "panel" : "glow"}
            size="sm"
            onClick={toggleCamera}
            disabled={camBusy}
            aria-label={camOn ? "Desligar câmera" : "Ativar câmera"}
          >
            {camBusy ? (
              <Loader2 className="animate-spin" />
            ) : camOn ? (
              <CameraOff />
            ) : (
              <Camera />
            )}
            <span className="hidden sm:inline">
              {camOn ? "Desligar" : "Câmera"}
            </span>
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Diminuir pincel"
              onClick={() => setSize((v) => clamp(v - 2, SIZE_MIN, SIZE_MAX))}
            >
              <Minus />
            </Button>
            <span className="w-8 text-center font-mono text-xs">{size}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Aumentar pincel"
              onClick={() => setSize((v) => clamp(v + 2, SIZE_MIN, SIZE_MAX))}
            >
              <Plus />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="tool"
              size="icon"
              data-active={neon}
              aria-pressed={neon}
              aria-label="Efeito neon"
              onClick={() => setNeon((v) => !v)}
            >
              <Zap />
            </Button>
            <Button
              variant="panel"
              size="icon"
              aria-label="Mais opções"
              onClick={() => setPanelOpen(true)}
            >
              <SlidersHorizontal />
            </Button>
            <Button
              variant="panel"
              size="icon"
              aria-label="Ver em 3D"
              title="Ver em 3D"
              onClick={open3D}
            >
              <Box />
            </Button>
          </div>
        </div>
      </main>

      {/* Side panel (desktop) */}
      <aside className="hidden flex-col gap-3 overflow-y-auto border-l border-border bg-rail p-4 lg:flex">
        {panel}
      </aside>

      {/* Same panel as a drawer on phones and tablets */}
      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent
          side="right"
          className="w-[min(340px,92vw)] overflow-y-auto bg-rail p-4 lg:hidden"
        >
          <SheetHeader className="mb-2 p-0 text-left">
            <SheetTitle>Ferramentas</SheetTitle>
            <SheetDescription>
              Pincel, mãos, formas e exportação
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3">{panel}</div>
        </SheetContent>
      </Sheet>

      <Sheet open={tutorialOpen} onOpenChange={setTutorialOpen}>
        <SheetContent side="right" className="w-[min(420px,92vw)] bg-rail p-5">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>Tutorial rápido</SheetTitle>
            <SheetDescription>
              Primeiros gestos para desenhar sem fricção.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="rounded-xl border border-border bg-panel p-3">
              <p className="mb-1 font-medium text-foreground">
                ☝ Indicador esticado
              </p>
              <p>
                Serve como pincel principal. Se o modo estiver em apagar, ele
                apaga em vez de desenhar.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-panel p-3">
              <p className="mb-1 font-medium text-foreground">🤏 Pinça</p>
              <p>
                Use para mover ou empurrar um traço já desenhado sem riscar o
                papel.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-panel p-3">
              <p className="mb-1 font-medium text-foreground">✌ Dois dedos</p>
              <p>
                Ativa a borracha. É o gesto mais confiável para apagar áreas
                maiores.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-panel p-3">
              <p className="mb-1 font-medium text-foreground">✋ Mão aberta</p>
              <p>
                Pausa o desenho e ajuda a evitar traços acidentais quando a mão
                se mexe.
              </p>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={galleryOpen} onOpenChange={setGalleryOpen}>
        <SheetContent side="right" className="w-[min(420px,92vw)] bg-rail p-5">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle>Galeria</SheetTitle>
            <SheetDescription>
              Seus últimos desenhos ficam salvos neste navegador.
            </SheetDescription>
          </SheetHeader>
          {gallery.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-panel p-5 text-sm text-muted-foreground">
              Nenhum desenho salvo ainda. Faça um primeiro traço e salve na
              galeria.
            </div>
          ) : (
            <div className="grid gap-3">
              {gallery.map((item) => (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-2xl border border-border bg-panel"
                >
                  <img
                    src={item.dataUrl}
                    alt={item.name}
                    className="h-40 w-full object-cover"
                  />
                  <div className="flex items-center justify-between gap-2 p-3 text-xs text-muted-foreground">
                    <span>{item.name}</span>
                    <span>
                      {new Date(item.createdAt).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {gallery.length > 0 && (
            <Button
              variant="ghost"
              className="mt-4 w-full"
              onClick={() => {
                setGallery([]);
                persistGallery([]);
              }}
            >
              Limpar galeria
            </Button>
          )}
        </SheetContent>
      </Sheet>

      {show3D && (
        <ClientOnly fallback={null}>
          <Suspense fallback={null}>
            <Scene3D
              open={show3D}
              onOpenChange={onScene3DOpenChange}
              handleRef={scene3DRef}
              strokes={scene3DStrokes}
              aspect={stageSize.w / Math.max(stageSize.h, 1)}
              stageHeight={stageSize.h}
              previewImage={scene3DPreview}
            />
          </Suspense>
        </ClientOnly>
      )}
    </div>
  );
}
