import { useCallback, useEffect, useRef } from "react";

type ClipKind = "camera" | "screen";
type ClipUpload = (blob: Blob, kind: ClipKind, eventType: string, durationSeconds: number) => Promise<void>;

const CLIP_SECONDS = 6;
const PRE_EVENT_SECONDS = 4;
const POST_EVENT_SECONDS = 2;

function recorderMime() {
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

/** Keeps only a tiny rolling in-memory window and uploads clips only for flags. */
export function useFlaggedSessionRecorder(uploadClip: ClipUpload) {
  const screenStreamRef = useRef<MediaStream | null>(null);
  const recordersRef = useRef<Partial<Record<ClipKind, MediaRecorder>>>({});
  const chunksRef = useRef<Partial<Record<ClipKind, Array<{ blob: Blob; at: number }>>>>({});
  const pendingRef = useRef<Promise<void>>(Promise.resolve());
  const activeRef = useRef(false);

  const startRecorder = useCallback((kind: ClipKind, stream: MediaStream) => {
    if (typeof MediaRecorder === "undefined") return;
    const mimeType = recorderMime();
    if (!mimeType) return;
    const chunks: Array<{ blob: Blob; at: number }> = [];
    chunksRef.current[kind] = chunks;
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 900_000 });
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      const now = Date.now();
      chunks.push({ blob: event.data, at: now });
      const cutoff = now - (CLIP_SECONDS + 1) * 1000;
      while (chunks.length && chunks[0].at < cutoff) chunks.shift();
    };
    recorder.start(500);
    recordersRef.current[kind] = recorder;
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    Object.values(recordersRef.current).forEach((recorder) => { if (recorder?.state !== "inactive") recorder?.stop(); });
    recordersRef.current = {};
    chunksRef.current = {};
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
  }, []);

  const start = useCallback(async (cameraStream: MediaStream) => {
    if (activeRef.current) return;
    const screenStream = screenStreamRef.current || await requestScreen();
    screenStreamRef.current = screenStream;
    screenStream.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
    activeRef.current = true;
    startRecorder("camera", cameraStream);
    startRecorder("screen", screenStream);
  }, [startRecorder, stop]);

  const requestScreen = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen recording is unavailable in this browser.");
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 12, max: 15 } }, audio: false });
    screenStreamRef.current = screenStream;
    screenStream.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
    return screenStream;
  }, [stop]);

  const flag = useCallback((eventType: string) => {
    if (!activeRef.current) return;
    const queuedAt = Date.now();
    pendingRef.current = pendingRef.current.then(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, POST_EVENT_SECONDS * 1000));
      for (const kind of ["camera", "screen"] as ClipKind[]) {
        const chunks = (chunksRef.current[kind] || []).filter(({ at }) => at >= queuedAt - PRE_EVENT_SECONDS * 1000 && at <= Date.now());
        if (!chunks.length) continue;
        const blob = new Blob(chunks.map(({ blob }) => blob), { type: chunks[0].blob.type || "video/webm" });
        await uploadClip(blob, kind, eventType, CLIP_SECONDS);
      }
    }).catch(() => undefined);
  }, [uploadClip]);

  useEffect(() => stop, [stop]);
  return { requestScreen, start, flag, stop };
}
