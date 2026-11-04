import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { Landmark } from "@/lib/airdraw/types";

// Must match the exact @mediapipe/tasks-vision version pinned in package.json.
const TASKS_VISION_VERSION = "1.2.0";
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type CameraStatus =
  "off" | "loading" | "on" | "denied" | "unsupported" | "error";

export type TrackedHand = { landmarks: Landmark[] };

export type HandFrame = {
  /** Every hand found in this frame (at most `maxHands`). Empty when none. */
  hands: TrackedHand[];
  videoWidth: number;
  videoHeight: number;
  t: number;
};

type Landmarker = {
  detectForVideo: (
    v: HTMLVideoElement,
    t: number,
  ) => { landmarks: Landmark[][] };
  setOptions: (o: { numHands: number }) => Promise<void>;
  close: () => void;
};

/**
 * Opens a single camera stream and runs MediaPipe HandLandmarker on every new
 * video frame. Browser only: the tracker library is imported on demand.
 */
export function useHandTracking(
  videoRef: RefObject<HTMLVideoElement | null>,
  onFrame: (frame: HandFrame) => void,
  maxHands = 1,
) {
  const [status, setStatus] = useState<CameraStatus>("off");
  const onFrameRef = useRef(onFrame);
  const landmarkerRef = useRef<Landmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<{ stop: () => void } | null>(null);
  const maxHandsRef = useRef(maxHands);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    maxHandsRef.current = maxHands;
    void landmarkerRef.current
      ?.setOptions({ numHands: maxHands })
      .catch(() => {});
  }, [maxHands]);

  const getLandmarker = useCallback(async (): Promise<Landmarker> => {
    if (landmarkerRef.current) return landmarkerRef.current;
    const { FilesetResolver, HandLandmarker } =
      await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const create = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: maxHandsRef.current,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.55,
      });
    let lm;
    try {
      lm = await create("GPU");
    } catch {
      lm = await create("CPU");
    }
    landmarkerRef.current = lm as unknown as Landmarker;
    return landmarkerRef.current;
  }, []);

  const stop = useCallback(() => {
    loopRef.current?.stop();
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("off");
    onFrameRef.current({
      hands: [],
      videoWidth: 0,
      videoHeight: 0,
      t: performance.now(),
    });
  }, [videoRef]);

  const start = useCallback(async () => {
    const video = videoRef.current;
    if (!video || streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    setStatus("loading");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
    } catch (e) {
      streamRef.current = null;
      const name = (e as DOMException)?.name;
      setStatus(
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : "error",
      );
      return;
    }

    let landmarker: Landmarker;
    try {
      landmarker = await getLandmarker();
    } catch {
      stop();
      setStatus("error");
      return;
    }
    if (!streamRef.current) return; // stopped while loading

    let running = true;
    let lastTime = -1;
    let handle = 0;
    const useRvfc = "requestVideoFrameCallback" in video;
    const tick = () => {
      if (!running) return;
      if (video.readyState >= 2 && video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        const t = performance.now();
        try {
          const handRes = landmarker.detectForVideo(video, t);
          onFrameRef.current({
            hands: (handRes.landmarks ?? [])
              .filter((lm) => lm.length >= 21)
              .map((landmarks) => ({ landmarks })),
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            t,
          });
        } catch {
          // Skip a bad frame.
        }
      }
      handle = useRvfc
        ? video.requestVideoFrameCallback(tick)
        : requestAnimationFrame(tick);
    };
    tick();
    loopRef.current = {
      stop: () => {
        running = false;
        if (useRvfc) video.cancelVideoFrameCallback(handle);
        else cancelAnimationFrame(handle);
      },
    };
    setStatus("on");
  }, [getLandmarker, stop, videoRef]);

  useEffect(
    () => () => {
      loopRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    },
    [],
  );

  return { status, start, stop };
}
