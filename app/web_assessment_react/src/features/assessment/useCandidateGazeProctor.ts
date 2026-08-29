import { useCallback, useEffect, useRef, useState } from "react";

type Landmark = { x: number; y: number; z?: number };
type FaceMetrics = Record<string, number>;
type GazeModel = {
  class_names: string[];
  scaler: { mean: number[]; scale: number[] };
  model: { coef: number[][]; intercept: number[] };
  thresholds?: Record<string, number>;
};
type VoiceModel = {
  scaler_mean: number[];
  scaler_scale: number[];
  coef: number[];
  intercept: number;
  threshold: number;
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
export type ProctorReadiness = {
  camera: "ready" | "checking" | "failed";
  microphone: "ready" | "checking" | "failed";
  lighting: "good" | "dim" | "checking";
  face: "ready" | "adjust" | "checking";
  message: string;
};

const VISION_WASM_URL = "/vendor/mediapipe/wasm";
const FACE_MODEL_URL = "/vendor/mediapipe/models/face_landmarker.task";
const OBJECT_MODEL_URL = "/vendor/mediapipe/models/efficientdet_lite0.tflite";
const GAZE_MODEL_URL = "/assets/generated/screen_gaze_model.json";
const VOICE_MODEL_URL = "/assets/generated/voice_overlap_model.json";
const AWAY_WARNING_MS = 9000;
const AWAY_WARNING_COOLDOWN_MS = 15_000;
const MULTI_FACE_CONFIRM_MS = 2400;
const VOICE_CONFIRM_MS = 2800;

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

// This is deliberately only a screening heuristic. A mono browser microphone
// cannot prove how many people are speaking; a trained diarization model is
// required for that. We look for sustained speech energy with unusually strong
// separated bands and report it for review instead of treating it as a violation.
function estimatePossibleVoiceOverlap(analyser: AnalyserNode) {
  const timeDomain = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(timeDomain);
  const rms = Math.sqrt(mean(Array.from(timeDomain, (value) => ((value - 128) / 128) ** 2)));
  if (rms <= 0.075) return { active: false, overlapScore: 0 };
  const spectrum = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(spectrum);
  const sampleRate = Number(analyser.context.sampleRate || 48_000);
  const binHz = sampleRate / analyser.fftSize;
  const bands = [[300, 900], [900, 1800], [1800, 3400]].map(([low, high]) => {
    const start = Math.max(0, Math.floor(low / binHz));
    const end = Math.min(spectrum.length, Math.ceil(high / binHz));
    return mean(Array.from(spectrum.slice(start, end))) / 255;
  }).sort((a, b) => b - a);
  const overlapScore = bands[0] > 0 ? bands[1] / bands[0] : 0;
  return { active: true, overlapScore };
}

function scoreVoiceFeatures(model: VoiceModel, values: number[]) {
  if (values.length !== model.coef.length) return 0;
  const logit = values.reduce((sum, value, index) => sum + model.coef[index] * ((value - model.scaler_mean[index]) / (Math.abs(model.scaler_scale[index]) || 1)), model.intercept);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logit))));
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
  const [readiness, setReadiness] = useState<ProctorReadiness>({ camera: "checking", microphone: "checking", lighting: "checking", face: "checking", message: "Preparing camera and microphone checks..." });
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
  const phoneFirstSeenRef = useRef(0);
  const onscreenNavigationGraceUntilRef = useRef(0);
  const multipleFaceSinceRef = useRef(0);
  const lastMultipleFaceSignalRef = useRef(0);
  const voiceSinceRef = useRef(0);
  const lastVoiceSignalRef = useRef(0);
  const lastObjectAdvisoryRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const voiceWorkletRef = useRef<AudioWorkletNode | null>(null);
  const voiceFeaturesRef = useRef<number[][]>([]);

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
    phoneFirstSeenRef.current = 0;
    multipleFaceSinceRef.current = 0;
    lastMultipleFaceSignalRef.current = 0;
    voiceSinceRef.current = 0;
    lastObjectAdvisoryRef.current = 0;
    audioSourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    voiceWorkletRef.current?.disconnect();
    void audioContextRef.current?.close();
    audioSourceRef.current = null;
    analyserRef.current = null;
    voiceWorkletRef.current = null;
    voiceFeaturesRef.current = [];
    audioContextRef.current = null;
    setReadiness({ camera: "checking", microphone: "checking", lighting: "checking", face: "checking", message: "Camera check stopped." });
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (status === "active") return;
    setStatus("starting");
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is unavailable in this browser.");
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = mediaStream;
      await video.play();
      videoRef.current = video;
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      audioSourceRef.current = audioContext.createMediaStreamSource(mediaStream);
      audioSourceRef.current.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      let voiceModel: VoiceModel | null = null;
      try {
        const response = await fetch(VOICE_MODEL_URL, { cache: "no-store" });
        if (response.ok) voiceModel = await response.json() as VoiceModel;
        await audioContext.audioWorklet.addModule("/worklets/voice-overlap-processor.js");
        const voiceWorklet = new AudioWorkletNode(audioContext, "voice-overlap-processor");
        voiceWorklet.port.onmessage = (event: MessageEvent<{ features?: number[] }>) => {
          if (!event.data?.features?.length) return;
          voiceFeaturesRef.current = [...voiceFeaturesRef.current.slice(-11), event.data.features];
        };
        audioSourceRef.current.connect(voiceWorklet);
        voiceWorkletRef.current = voiceWorklet;
      } catch {
        // The spectral fallback below remains available if the optional
        // browser model/worklet cannot load on an older browser.
      }
      setReadiness((current) => ({ ...current, camera: "ready", microphone: "ready", message: "Checking face position and lighting..." }));

      const vision = await import("@mediapipe/tasks-vision") as {
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
        baseOptions: { modelAssetPath: OBJECT_MODEL_URL }, runningMode: "VIDEO", maxResults: 8, scoreThreshold: 0.25,
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
      if (Number(reference.eyeDist || 0) < 0.10 || Number(reference.faceCenterX || 0.5) < 0.18 || Number(reference.faceCenterX || 0.5) > 0.82 || Number(reference.faceCenterY || 0.5) < 0.12 || Number(reference.faceCenterY || 0.5) > 0.88) {
        throw new Error("Sit a little farther back and center your complete face in the camera.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data;
      const luminance = pixels ? mean(Array.from({ length: pixels.length / 4 }, (_, index) => 0.2126 * pixels[index * 4] + 0.7152 * pixels[index * 4 + 1] + 0.0722 * pixels[index * 4 + 2])) : 0;
      if (luminance < 42) {
        setReadiness({ camera: "ready", microphone: "ready", lighting: "dim", face: "ready", message: "Lighting is a little dim. Add light facing you if possible, then continue." });
      } else {
        setReadiness({ camera: "ready", microphone: "ready", lighting: "good", face: "ready", message: "Camera, microphone, face framing, and lighting check passed." });
      }
      setStatus("active");
      frameTimerRef.current = window.setInterval(() => {
        const currentVideo = videoRef.current;
        const currentLandmarker = landmarkerRef.current;
        const currentObjectDetector = objectDetectorRef.current;
        if (!currentVideo || !currentLandmarker || !currentObjectDetector || currentVideo.readyState < 2) return;
        const frameTimestamp = performance.now();
        const now = Date.now();
        let suspicious = false;
        try {
          const faces = currentLandmarker.detectForVideo(currentVideo, frameTimestamp).faceLandmarks || [];
          if (faces.length === 0) {
            // A brief occlusion or natural movement is not a violation.
            suspicious = false;
          } else if (faces.length > 1) {
            if (!multipleFaceSinceRef.current) multipleFaceSinceRef.current = now;
            if (now - multipleFaceSinceRef.current >= MULTI_FACE_CONFIRM_MS && now - lastMultipleFaceSignalRef.current >= 5000) {
              emitProctorSignal("multiple_faces_sustained", { face_count: faces.length, duration_ms: now - multipleFaceSinceRef.current });
              lastMultipleFaceSignalRef.current = now;
            }
            suspicious = false;
          } else {
            multipleFaceSinceRef.current = 0;
            const metrics = computeFaceMetrics(faces[0]);
            suspicious = !metrics || isAway(gazeModel, metrics, reference);
          }
        } catch {
          return;
        }
        if (now - lastObjectScanRef.current >= 850) {
          lastObjectScanRef.current = now;
          try {
            const detections = currentObjectDetector.detectForVideo(currentVideo, frameTimestamp).detections || [];
            const categories = detections.flatMap((detection) => detection.categories || []);
            const phone = categories
              .filter((category) => {
                const label = String(category.categoryName || category.displayName || "").trim().toLowerCase();
                return ["cell phone", "cellphone", "mobile phone", "phone", "smartphone"].includes(label);
              })
              .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
            if (phone) {
              if (!phoneDetectionStreakRef.current) phoneFirstSeenRef.current = now;
              phoneDetectionStreakRef.current += 1;
            } else {
              phoneDetectionStreakRef.current = 0;
              phoneFirstSeenRef.current = 0;
            }
            const phoneConfidence = Number(phone?.score || 0);
            const requiredPhoneFrames = 3;
            if (phone && phoneConfidence >= 0.55 && phoneDetectionStreakRef.current >= requiredPhoneFrames && now - lastPhoneWarningRef.current >= 8000) {
              lastPhoneWarningRef.current = now;
              phoneDetectionStreakRef.current = 0;
              emitProctorSignal("mobile_phone_detected", {
                confidence: Number(phoneConfidence.toFixed(4)),
                object_label: String(phone.categoryName || phone.displayName || "cell phone"),
                consecutive_frames: requiredPhoneFrames,
                duration_ms: Math.max(0, now - phoneFirstSeenRef.current),
              });
            }
            const nonPhone = categories.find((category) => {
              const label = String(category.categoryName || category.displayName || "").trim().toLowerCase();
              return ["laptop", "keyboard", "book", "remote", "tablet"].includes(label) && Number(category.score || 0) >= 0.65;
            });
            if (nonPhone && now - lastObjectAdvisoryRef.current >= 10_000) {
              lastObjectAdvisoryRef.current = now;
              emitProctorSignal("object_detected_advisory", { object_label: String(nonPhone.categoryName || nonPhone.displayName), confidence: Number(Number(nonPhone.score || 0).toFixed(4)) });
            }
          } catch {
            phoneDetectionStreakRef.current = 0;
          }
        }
        const analyser = analyserRef.current;
        if (analyser) {
          const modelFeatures = voiceFeaturesRef.current;
          const averageFeatures = modelFeatures.length >= 6
            ? modelFeatures[0].map((_, index) => mean(modelFeatures.slice(-6).map((features) => features[index])))
            : null;
          const modelProbability = voiceModel && averageFeatures ? scoreVoiceFeatures(voiceModel, averageFeatures) : 0;
          const voice = estimatePossibleVoiceOverlap(analyser);
          const possibleOverlap = modelProbability >= Number(voiceModel?.threshold ?? 0.65) || (!voiceModel && voice.active && voice.overlapScore >= 0.72);
          if (possibleOverlap) {
            if (!voiceSinceRef.current) voiceSinceRef.current = now;
            if (now - voiceSinceRef.current >= VOICE_CONFIRM_MS && now - lastVoiceSignalRef.current >= 12_000) {
              lastVoiceSignalRef.current = now;
              emitProctorSignal("possible_overlapping_voice_activity_advisory", { duration_ms: now - voiceSinceRef.current, overlap_score: Number((modelProbability || voice.overlapScore).toFixed(4)), source: modelProbability ? "voice_overlap_v2" : "spectral_fallback" });
            }
          } else voiceSinceRef.current = 0;
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
        if (duration >= AWAY_WARNING_MS && now - lastWarningRef.current >= AWAY_WARNING_COOLDOWN_MS) {
          lastWarningRef.current = now;
          emitProctorSignal("look_away_sustained", { duration_ms: duration });
        }
      }, 220);
      return mediaStream;
    } catch (caught) {
      stop();
      setStatus("error");
      const message = caught instanceof Error ? caught.message : "Camera proctoring could not start.";
      setError(message.includes("Permission") || message.includes("denied") ? "Camera and microphone permission are required for this assessment." : message);
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

  return { status, error, stream, readiness, start, stop };
}
