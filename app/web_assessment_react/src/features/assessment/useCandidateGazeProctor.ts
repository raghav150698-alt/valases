import { useCallback, useEffect, useRef, useState } from "react";

type Landmark = { x: number; y: number; z?: number };
type FaceMetrics = Record<string, number>;
type GazeModel = {
  class_names: string[];
  scaler: { mean: number[]; scale: number[] };
  model: { coef: number[][]; intercept: number[] };
  thresholds?: Record<string, number>;
};
type FaceLandmarker = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => { faceLandmarks?: Landmark[][] };
  close?: () => void;
};
type DetectionCategory = { categoryName?: string; displayName?: string; score?: number };
type ObjectDetector = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => { detections?: Array<{ categories?: DetectionCategory[] }> };
  close?: () => void;
};
type ProctorStatus = "idle" | "starting" | "calibrating" | "active" | "error";

const VISION_MODULE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const VISION_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const OBJECT_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite";
const GAZE_MODEL_URL = "/assets/generated/screen_gaze_model.json";
const AWAY_WARNING_MS = 2000;

function mean(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function computeFaceMetrics(lm: Landmark[]): FaceMetrics | null {
  const leftEye = lm[33];
  const rightEye = lm[263];
  const nose = lm[1];
  if (!leftEye || !rightEye || !nose) return null;
  const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  if (!Number.isFinite(eyeDist) || eyeDist < 0.00001) return null;
  const irisAverage = (indexes: number[], axis: "x" | "y") => mean(indexes.map((index) => lm[index]?.[axis]).filter(Number.isFinite));
  const leftGazeX = (irisAverage([468, 469, 470, 471, 472], "x") - leftEye.x) / ((lm[133]?.x || leftEye.x) - leftEye.x || 0.000001);
  const rightGazeX = (irisAverage([473, 474, 475, 476, 477], "x") - (lm[362]?.x || rightEye.x)) / (rightEye.x - (lm[362]?.x || rightEye.x) || 0.000001);
  const leftGazeY = (irisAverage([468, 469, 470, 471, 472], "y") - (lm[159]?.y || leftEye.y)) / ((lm[145]?.y || leftEye.y) - (lm[159]?.y || leftEye.y) || 0.000001);
  const rightGazeY = (irisAverage([473, 474, 475, 476, 477], "y") - (lm[386]?.y || rightEye.y)) / ((lm[374]?.y || rightEye.y) - (lm[386]?.y || rightEye.y) || 0.000001);
  const mouthWidth = Math.hypot((lm[308]?.x || 0) - (lm[78]?.x || 0), (lm[308]?.y || 0) - (lm[78]?.y || 0));
  const mouthHeight = Math.hypot((lm[14]?.x || 0) - (lm[13]?.x || 0), (lm[14]?.y || 0) - (lm[13]?.y || 0));
  return {
    eyeDist,
    noseLeft: Math.hypot(nose.x - leftEye.x, nose.y - leftEye.y) / eyeDist,
    noseRight: Math.hypot(nose.x - rightEye.x, nose.y - rightEye.y) / eyeDist,
    ratio: (nose.x - leftEye.x) / (rightEye.x - leftEye.x || 0.000001),
    faceCenterX: (leftEye.x + rightEye.x + nose.x) / 3,
    faceCenterY: (leftEye.y + rightEye.y + nose.y) / 3,
    leftEyeOpenRatio: Math.abs((lm[145]?.y || leftEye.y) - (lm[159]?.y || leftEye.y)) / eyeDist,
    rightEyeOpenRatio: Math.abs((lm[374]?.y || rightEye.y) - (lm[386]?.y || rightEye.y)) / eyeDist,
    leftGazeX,
    rightGazeX,
    leftGazeY,
    rightGazeY,
    mouthOpenRatio: mouthHeight / (mouthWidth || 0.000001),
  };
}

function averageMetrics(samples: FaceMetrics[]) {
  const output: FaceMetrics = {};
  for (const key of Object.keys(samples[0] || {})) output[key] = mean(samples.map((sample) => sample[key]).filter(Number.isFinite));
  return output;
}

function featureVector(metrics: FaceMetrics, ref: FaceMetrics) {
  const delta = (key: string, fallback = 0) => Number(metrics[key] ?? fallback) - Number(ref[key] ?? fallback);
  const leftEyeOpenDelta = delta("leftEyeOpenRatio");
  const rightEyeOpenDelta = delta("rightEyeOpenRatio");
  const leftGazeXDelta = delta("leftGazeX");
  const rightGazeXDelta = delta("rightGazeX");
  const leftGazeYDelta = delta("leftGazeY");
  const rightGazeYDelta = delta("rightGazeY");
  const ratioDelta = delta("ratio", 0.5);
  const avgGazeXDelta = (leftGazeXDelta + rightGazeXDelta) / 2;
  const avgGazeYDelta = (leftGazeYDelta + rightGazeYDelta) / 2;
  return [
    delta("noseLeft"), delta("noseRight"), ratioDelta, leftEyeOpenDelta, rightEyeOpenDelta,
    leftGazeXDelta, rightGazeXDelta, leftGazeYDelta, rightGazeYDelta, delta("mouthOpenRatio"),
    avgGazeXDelta, avgGazeYDelta, leftGazeXDelta - rightGazeXDelta, leftGazeYDelta - rightGazeYDelta,
    (leftEyeOpenDelta + rightEyeOpenDelta) / 2, leftEyeOpenDelta - rightEyeOpenDelta,
    Math.abs(avgGazeXDelta) + Math.abs(ratioDelta) * 0.7, Math.abs(avgGazeYDelta), Math.hypot(avgGazeXDelta, avgGazeYDelta),
  ];
}

function isAway(model: GazeModel, metrics: FaceMetrics, ref: FaceMetrics) {
  const features = featureVector(metrics, ref);
  if (model.scaler.mean.length !== features.length || model.scaler.scale.length !== features.length) return false;
  const scaled = features.map((value, index) => (value - Number(model.scaler.mean[index] || 0)) / (Math.abs(Number(model.scaler.scale[index] || 1)) || 1));
  const logits = model.model.coef.map((row, rowIndex) => row.reduce((total, weight, index) => total + Number(weight || 0) * scaled[index], Number(model.model.intercept[rowIndex] || 0)));
  const maxLogit = Math.max(...logits);
  const exponents = logits.map((value) => Math.exp(value - maxLogit));
  const total = exponents.reduce((sum, value) => sum + value, 0) || 1;
  const probabilities = exponents.map((value) => value / total);
  const awayIndex = model.class_names.indexOf("away");
  const topIndex = probabilities.indexOf(Math.max(...probabilities));
  const awayProbability = awayIndex >= 0 ? probabilities[awayIndex] : 0;
  const minAwayProbability = Math.max(
    Number(model.thresholds?.suspect_away_probability ?? 0.48),
    Number(model.thresholds?.min_top_class_probability ?? 0.34),
  );
  return model.class_names[topIndex] === "away" && awayProbability >= minAwayProbability;
}

function emitProctorSignal(eventType: string, details: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent("valases:proctor-signal", { detail: { event_type: eventType, ...details } }));
}

export function useCandidateGazeProctor(active: boolean) {
  const [status, setStatus] = useState<ProctorStatus>("idle");
  const [error, setError] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const objectDetectorRef = useRef<ObjectDetector | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const awaySinceRef = useRef(0);
  const lastWarningRef = useRef(0);
  const lastObjectScanRef = useRef(0);
  const lastPhoneWarningRef = useRef(0);
  const phoneDetectionStreakRef = useRef(0);
  const onscreenNavigationGraceUntilRef = useRef(0);

  const stop = useCallback(() => {
    if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    videoRef.current?.remove();
    videoRef.current = null;
    landmarkerRef.current?.close?.();
    landmarkerRef.current = null;
    objectDetectorRef.current?.close?.();
    objectDetectorRef.current = null;
    awaySinceRef.current = 0;
    lastObjectScanRef.current = 0;
    phoneDetectionStreakRef.current = 0;
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (status === "active") return;
    setStatus("starting");
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is unavailable in this browser.");
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = mediaStream;
      await video.play();
      videoRef.current = video;

      const vision = await import(/* @vite-ignore */ VISION_MODULE_URL) as {
        FilesetResolver: { forVisionTasks: (url: string) => Promise<unknown> };
        FaceLandmarker: { createFromOptions: (resolver: unknown, options: unknown) => Promise<FaceLandmarker> };
        ObjectDetector: { createFromOptions: (resolver: unknown, options: unknown) => Promise<ObjectDetector> };
      };
      const resolver = await vision.FilesetResolver.forVisionTasks(VISION_WASM_URL);
      const landmarker = await vision.FaceLandmarker.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL }, runningMode: "VIDEO", numFaces: 2,
      });
      landmarkerRef.current = landmarker;
      const objectDetector = await vision.ObjectDetector.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: OBJECT_MODEL_URL }, runningMode: "VIDEO", maxResults: 6, scoreThreshold: 0.45,
      });
      objectDetectorRef.current = objectDetector;
      const gazeModelResponse = await fetch(GAZE_MODEL_URL, { cache: "no-store" });
      if (!gazeModelResponse.ok) throw new Error("The gaze model could not be loaded.");
      const gazeModel = await gazeModelResponse.json() as GazeModel;

      setStatus("calibrating");
      const samples: FaceMetrics[] = [];
      const calibrationEndsAt = Date.now() + 2400;
      while (Date.now() < calibrationEndsAt) {
        const faces = landmarker.detectForVideo(video, performance.now()).faceLandmarks || [];
        if (faces.length === 1) {
          const metrics = computeFaceMetrics(faces[0]);
          if (metrics) samples.push(metrics);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
      if (samples.length < 5) throw new Error("Keep one clearly visible face in the camera and try again.");
      const reference = averageMetrics(samples);
      setStatus("active");
      frameTimerRef.current = window.setInterval(() => {
        const currentVideo = videoRef.current;
        const currentLandmarker = landmarkerRef.current;
        const currentObjectDetector = objectDetectorRef.current;
        if (!currentVideo || !currentLandmarker || !currentObjectDetector || currentVideo.readyState < 2) return;
        const frameTimestamp = performance.now();
        let suspicious = false;
        try {
          const faces = currentLandmarker.detectForVideo(currentVideo, frameTimestamp).faceLandmarks || [];
          if (faces.length !== 1) suspicious = true;
          else {
            const metrics = computeFaceMetrics(faces[0]);
            suspicious = !metrics || isAway(gazeModel, metrics, reference);
          }
        } catch {
          return;
        }
        const now = Date.now();
        if (now - lastObjectScanRef.current >= 850) {
          lastObjectScanRef.current = now;
          try {
            const detections = currentObjectDetector.detectForVideo(currentVideo, frameTimestamp).detections || [];
            const categories = detections.flatMap((detection) => detection.categories || []);
            const phone = categories
              .filter((category) => {
                const label = String(category.categoryName || category.displayName || "").trim().toLowerCase();
                return label === "cell phone" || label === "mobile phone" || label === "phone";
              })
              .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
            phoneDetectionStreakRef.current = phone ? phoneDetectionStreakRef.current + 1 : 0;
            if (phone && phoneDetectionStreakRef.current >= 2 && now - lastPhoneWarningRef.current >= 8000) {
              lastPhoneWarningRef.current = now;
              phoneDetectionStreakRef.current = 0;
              emitProctorSignal("mobile_phone_detected", {
                confidence: Number(Number(phone.score || 0).toFixed(4)),
                object_label: String(phone.categoryName || phone.displayName || "cell phone"),
              });
            }
          } catch {
            phoneDetectionStreakRef.current = 0;
          }
        }
        if (now < onscreenNavigationGraceUntilRef.current) {
          awaySinceRef.current = 0;
          return;
        }
        if (!suspicious) {
          awaySinceRef.current = 0;
          return;
        }
        if (!awaySinceRef.current) awaySinceRef.current = now;
        const duration = now - awaySinceRef.current;
        if (duration >= AWAY_WARNING_MS && now - lastWarningRef.current >= 4000) {
          lastWarningRef.current = now;
          emitProctorSignal("look_away_over_2s", { duration_ms: duration });
        }
      }, 220);
    } catch (caught) {
      stop();
      setStatus("error");
      const message = caught instanceof Error ? caught.message : "Camera proctoring could not start.";
      setError(message.includes("Permission") || message.includes("denied") ? "Camera permission is required for this assessment." : message);
      throw caught;
    }
  }, [status, stop]);

  useEffect(() => {
    if (!active && status === "active") stop();
  }, [active, status, stop]);
  useEffect(() => {
    const handleOnscreenNavigation = () => {
      onscreenNavigationGraceUntilRef.current = Date.now() + 3500;
      awaySinceRef.current = 0;
    };
    window.addEventListener("valases:onscreen-navigation", handleOnscreenNavigation);
    return () => window.removeEventListener("valases:onscreen-navigation", handleOnscreenNavigation);
  }, []);
  useEffect(() => stop, [stop]);

  return { status, error, stream, start, stop };
}
